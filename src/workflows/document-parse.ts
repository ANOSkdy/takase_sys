import "server-only";
import { createHash } from "node:crypto";
import { and, eq, sql } from "drizzle-orm";
import { FatalError, RetryableError, getStepMetadata } from "workflow";
import { getDb } from "@/db/client";
import { documentDiffItems, documentLineItems, documentParseRuns, documents } from "@/db/schema";
import { splitPdfToSinglePages } from "@/pdf/splitPdfToSinglePages";
import { parseSinglePage } from "@/services/ai/gemini";
import type { ParsedInvoice } from "@/services/ai/schema";
import { mergeParsedInvoices } from "@/services/documents/page-merge";
import {
  listPageAssets,
  upsertPageAsset,
} from "@/services/documents/page-assets-repository";
import { getMaxPdfPages } from "@/services/documents/constants";
import { toPgDateString } from "@/services/documents/pg-date";
import {
  getDocumentParsePageStatus,
  listFailedPageNos,
  listSucceededParsePages,
  upsertDocumentParsePage,
} from "@/services/documents/parse-pages-repository";
import { getObjectBytes, putObjectBytes } from "@/services/storage";

const EMPTY_PARSED_INVOICE: ParsedInvoice = { vendorName: null, invoiceDate: null, lineItems: [] };

function isTransientError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /429|timeout|ETIMEDOUT|5\d\d|temporar/i.test(message);
}

async function loadParseContextStep(parseRunId: string) {
  "use step";
  const db = getDb();
  const [row] = await db
    .select({
      parseRunId: documentParseRuns.parseRunId,
      documentId: documentParseRuns.documentId,
      model: documentParseRuns.model,
      promptVersion: documentParseRuns.promptVersion,
      storageKey: documents.storageKey,
      isDeleted: documents.isDeleted,
    })
    .from(documentParseRuns)
    .innerJoin(documents, eq(documents.documentId, documentParseRuns.documentId))
    .where(eq(documentParseRuns.parseRunId, parseRunId))
    .limit(1);

  if (!row || row.isDeleted) throw new FatalError("PARSE_RUN_OR_DOCUMENT_NOT_FOUND");
  return row;
}

function buildPageAssetStorageKey(documentId: string, pageNo: number): string {
  return `documents/${documentId}/pages/page-${pageNo}.pdf`;
}

async function preparePageAssetsStep(input: { documentId: string; storageKey: string }) {
  "use step";
  const pdfBytes = await getObjectBytes(input.storageKey);
  const { pageCount, processedPages, pages } = await splitPdfToSinglePages(pdfBytes, getMaxPdfPages());

  for (const page of pages) {
    const storageKey = buildPageAssetStorageKey(input.documentId, page.pageNo);
    await putObjectBytes(storageKey, page.bytes, { contentType: "application/pdf" });
    const pageHash = createHash("sha256").update(page.bytes).digest("hex");
    await upsertPageAsset(
      input.documentId,
      page.pageNo,
      storageKey,
      pageHash,
      page.bytes.byteLength,
      "application/pdf",
    );
  }

  return { pageCount, processedPages };
}

async function fetchSinglePageBase64Step(input: { documentId: string; pageNo: number }): Promise<string> {
  "use step";
  const assets = await listPageAssets(input.documentId);
  const asset = assets.find((row) => row.pageNo === input.pageNo);
  if (!asset) {
    throw new FatalError(`PAGE_ASSET_NOT_FOUND:${input.pageNo}`);
  }
  const bytes = await getObjectBytes(asset.storageKey);
  return bytes.toString("base64");
}

export async function parsePdfPageStep(
  parseRunId: string,
  documentId: string,
  pageNo: number,
): Promise<{ pageNo: number; status: "SUCCEEDED" | "FAILED" | "SKIPPED" }> {
  "use step";
  const { stepId, attempt } = getStepMetadata();

  try {
    const existingStatus = await getDocumentParsePageStatus({ parseRunId, pageNo });
    if (existingStatus === "SUCCEEDED") {
      return { pageNo, status: "SKIPPED" };
    }

    await upsertDocumentParsePage({
      parseRunId,
      pageNo,
      patch: { status: "RUNNING", stepId, attempt, markStartedAt: true, errorSummary: null, parsedJson: EMPTY_PARSED_INVOICE },
    });

    const pageBytesBase64 = await fetchSinglePageBase64Step({ documentId, pageNo });
    const parsed = await parseSinglePage({ pageBytesBase64, pageNo });
    await upsertDocumentParsePage({
      parseRunId,
      pageNo,
      patch: { status: "SUCCEEDED", parsedJson: parsed, markFinishedAt: true, stepId, attempt },
    });
    return { pageNo, status: "SUCCEEDED" };
  } catch (error) {
    if (isTransientError(error) && attempt < 3) {
      throw new RetryableError("PAGE_PARSE_RETRY", { retryAfter: "30s" });
    }

    try {
      await upsertDocumentParsePage({
        parseRunId,
        pageNo,
        patch: {
          status: "FAILED",
          parsedJson: EMPTY_PARSED_INVOICE,
          errorSummary: error instanceof Error ? error.message.slice(0, 500) : "PAGE_PARSE_FAILED",
          markFinishedAt: true,
          stepId,
          attempt,
        },
      });
    } catch (persistError) {
      console.error("PAGE_FAILURE_PERSIST_ERROR", {
        parseRunId,
        pageNo,
        reason: persistError instanceof Error ? persistError.message : "UNKNOWN",
      });
    }

    return { pageNo, status: "FAILED" };
  }
}

export async function mergeFinalizeStep(
  parseRunId: string,
  input: { pageCount: number; processedPages: number; documentId: string },
): Promise<{
  status: "SUCCEEDED" | "PARTIAL" | "FAILED";
  documentStatus: "PARSED" | "PARSED_PARTIAL" | "FAILED";
}> {
  "use step";
  const db = getDb();
  const succeededPages = await listSucceededParsePages(parseRunId);
  const failedPageNos = await listFailedPageNos(parseRunId);

  const parsedPages = succeededPages.map((row) => row.parsedJson).filter((row): row is ParsedInvoice => Boolean(row));

  const merged =
    parsedPages.length > 0
      ? mergeParsedInvoices(parsedPages)
      : { vendorName: null, invoiceDate: null, lineItems: [] };

  await db.transaction(async (tx) => {
    await tx.delete(documentDiffItems).where(eq(documentDiffItems.parseRunId, parseRunId));
    await tx.delete(documentLineItems).where(eq(documentLineItems.parseRunId, parseRunId));

    const lineRows = merged.lineItems.map((item, index) => ({
      lineItemId: crypto.randomUUID(),
      parseRunId,
      lineNo: index + 1,
      productNameRaw: item.productName ?? null,
      specRaw: item.spec ?? null,
      productKeyCandidate: null,
      quantity: item.quantity?.toString() ?? null,
      unitPrice: item.unitPrice?.toString() ?? null,
      amount: item.amount?.toString() ?? null,
      modelConfidence: item.confidence?.toString() ?? null,
      systemConfidence: item.confidence?.toString() ?? null,
      matchedProductId: null,
    }));

    if (lineRows.length > 0) {
      await tx.insert(documentLineItems).values(lineRows);
    }

    const failedPages = failedPageNos.length;
    const succeeded = succeededPages.length;
    const runStatus: "SUCCEEDED" | "PARTIAL" | "FAILED" =
      failedPages === 0 && succeeded > 0 ? "SUCCEEDED" : succeeded > 0 ? "PARTIAL" : "FAILED";
    const documentStatus: "PARSED" | "PARSED_PARTIAL" | "FAILED" =
      runStatus === "SUCCEEDED" ? "PARSED" : runStatus === "PARTIAL" ? "PARSED_PARTIAL" : "FAILED";
    const parseErrorSummary =
      runStatus === "FAILED"
        ? "PDF解析に失敗しました。"
        : runStatus === "PARTIAL"
          ? `一部ページの解析に失敗しました: ${failedPageNos.join(",")}`
          : null;

    await tx
      .update(documentParseRuns)
      .set({
        status: runStatus,
        finishedAt: sql`now()`,
        stats: {
          pageCount: input.pageCount,
          processedPages: input.processedPages,
          succeededPages: succeeded,
          failedPages,
          failedPageNos,
          lineItemCount: lineRows.length,
          diffCount: 0,
        },
        errorDetail: parseErrorSummary,
      })
      .where(eq(documentParseRuns.parseRunId, parseRunId));

    await tx
      .update(documents)
      .set({
        status: documentStatus,
        vendorName: merged.vendorName,
        invoiceDate: toPgDateString(merged.invoiceDate),
        parseErrorSummary,
      })
      .where(and(eq(documents.documentId, input.documentId), eq(documents.isDeleted, false)));
  });

  const failedPages = failedPageNos.length;
  const succeeded = succeededPages.length;
  const status = failedPages === 0 && succeeded > 0 ? "SUCCEEDED" : succeeded > 0 ? "PARTIAL" : "FAILED";
  const documentStatus = status === "SUCCEEDED" ? "PARSED" : status === "PARTIAL" ? "PARSED_PARTIAL" : "FAILED";

  return { status, documentStatus };
}


async function failParseRunStep(input: { parseRunId: string; documentId: string; reason: string }) {
  "use step";
  const db = getDb();
  await db.transaction(async (tx) => {
    await tx
      .update(documentParseRuns)
      .set({ status: "FAILED", finishedAt: sql`now()`, errorDetail: input.reason })
      .where(eq(documentParseRuns.parseRunId, input.parseRunId));

    await tx
      .update(documents)
      .set({ status: "FAILED", parseErrorSummary: input.reason })
      .where(and(eq(documents.documentId, input.documentId), eq(documents.isDeleted, false)));
  });
}

export async function runDocumentParseWorkflow(parseRunId: string) {
  "use workflow";
  const context = await loadParseContextStep(parseRunId);

  try {
    const { pageCount, processedPages } = await preparePageAssetsStep({
      documentId: context.documentId,
      storageKey: context.storageKey,
    });

    for (let pageNo = 1; pageNo <= processedPages; pageNo += 1) {
      await parsePdfPageStep(parseRunId, context.documentId, pageNo);
    }

    return mergeFinalizeStep(parseRunId, {
      pageCount,
      processedPages,
      documentId: context.documentId,
    });
  } catch (error) {
    const reason = error instanceof Error ? error.message.slice(0, 500) : "PARSE_WORKFLOW_FAILED";
    await failParseRunStep({ parseRunId, documentId: context.documentId, reason });
    throw error;
  }
}
