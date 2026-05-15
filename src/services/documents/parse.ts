import "server-only";
import { and, asc, desc, eq, inArray } from "drizzle-orm";
import { getDb } from "@/db/client";
import {
  documentDiffItems,
  documentLineItems,
  documentParseRuns,
  documents,
  productMaster,
  updateHistory,
  vendorPrices,
} from "@/db/schema";
import { getEnv } from "@/config/env";
import { normalizeText, makeProductKey } from "@/domain/normalize";
import { safeParseFloat, toNumericString } from "@/domain/pg-numeric";
import { shouldBlockUpdate } from "@/domain/update-policy";
import { getStorageProvider } from "@/services/storage";
import { parseInvoiceFromPdf } from "@/services/ai/gemini";
import { assertSinglePagePdf } from "@/services/documents/parse-guard";
import { PROMPT_VERSION } from "@/services/ai/prompt";

type ParseRunInsert = typeof documentParseRuns.$inferInsert;
type LineItemInsert = typeof documentLineItems.$inferInsert;
type DiffItemInsert = typeof documentDiffItems.$inferInsert;
type VendorPriceInsert = typeof vendorPrices.$inferInsert;
type UpdateHistoryInsert = typeof updateHistory.$inferInsert;

const dateRegex = /^\d{4}-\d{2}-\d{2}$/;
const noLineItemsErrorCode = "NO_LINE_ITEMS_EXTRACTED";
const noUsableLineItemsErrorCode = "NO_USABLE_LINE_ITEMS_EXTRACTED";
const noLineItemsSummary =
  "PDFから明細を抽出できませんでした。明細表が写っているか、スキャン品質やPDF内容を確認してください。";
const noUsableLineItemsSummary =
  "PDFから明細候補は抽出されましたが、商品名・商品キーを作成できる明細がありませんでした。明細の品名欄やPDF品質を確認してください。";

type LineItemContext = {
  lineItemId: string;
  lineNo: number;
  productMaker: string | null;
  productNameRaw: string;
  specRaw: string | null;
  productKeyCandidate: string;
  legacyProductKeyCandidate: string;
  quantity: string | null;
  unitPrice: string | null;
  amount: string | null;
  modelConfidence: string | null;
  systemConfidence: string | null;
  systemConfidenceNum: number | null;
  matchedProductId: string | null;
  matchedProductSpec: string | null;
  matchedProductCategory: string | null;
};

type VendorPriceRow = {
  vendorPriceId: string;
  productId: string;
  unitPrice: string;
  priceUpdatedOn: string | null;
};

type DocumentRow = {
  documentId: string;
  storageKey: string;
  isDeleted: boolean;
};

export type ParseDocumentResult = {
  parseRunId: string;
  status: "SUCCEEDED" | "FAILED";
};

function buildParseRunRow(input: {
  parseRunId: string;
  documentId: string;
  model: string;
  stats: Record<string, unknown>;
}): ParseRunInsert {
  return {
    parseRunId: input.parseRunId,
    documentId: input.documentId,
    startedAt: new Date(),
    status: "RUNNING",
    model: input.model,
    promptVersion: PROMPT_VERSION,
    stats: input.stats,
  };
}

function buildLineItemRow(
  input: LineItemContext & { parseRunId: string },
): LineItemInsert {
  return {
    lineItemId: input.lineItemId,
    parseRunId: input.parseRunId,
    lineNo: input.lineNo,
    productNameRaw: input.productNameRaw,
    specRaw: input.specRaw,
    productKeyCandidate: input.productKeyCandidate,
    quantity: input.quantity,
    unitPrice: input.unitPrice,
    amount: input.amount,
    modelConfidence: input.modelConfidence,
    systemConfidence: input.systemConfidence,
    matchedProductId: input.matchedProductId,
  };
}

function buildDiffItemRow(input: {
  diffItemId: string;
  parseRunId: string;
  lineItemId: string;
  classification: string;
  reason?: string | null;
  vendorName: string | null;
  invoiceDate: string | null;
  before: Record<string, unknown>;
  after: Record<string, unknown>;
}): DiffItemInsert {
  return {
    diffItemId: input.diffItemId,
    parseRunId: input.parseRunId,
    lineItemId: input.lineItemId,
    classification: input.classification,
    reason: input.reason ?? null,
    vendorName: input.vendorName,
    invoiceDate: input.invoiceDate,
    before: input.before,
    after: input.after,
  };
}

function buildVendorPriceRow(input: {
  vendorPriceId: string;
  productId: string;
  vendorName: string;
  unitPrice: string;
  priceUpdatedOn: string | null;
  sourceId: string;
}): VendorPriceInsert {
  return {
    vendorPriceId: input.vendorPriceId,
    productId: input.productId,
    vendorName: input.vendorName,
    unitPrice: input.unitPrice,
    priceUpdatedOn: input.priceUpdatedOn,
    sourceType: "PDF",
    sourceId: input.sourceId,
    updatedAt: new Date(),
  };
}

function sanitizeProductName(input: {
  productName: string;
  productMaker: string | null;
}): string {
  const normalizedName = normalizeText(input.productName);
  if (!normalizedName) return "";
  if (!input.productMaker) return normalizedName;

  const normalizedMaker = normalizeText(input.productMaker);
  if (!normalizedMaker) return normalizedName;

  const escapedMaker = normalizedMaker.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const makerPrefixRegex = new RegExp(`^${escapedMaker}[\\s:/：｜・-]*`);
  const stripped = normalizedName.replace(makerPrefixRegex, "").trim();
  return stripped || normalizedName;
}

function buildUpdateHistoryRow(input: {
  updateKey: string;
  productId: string;
  fieldName: string;
  vendorName?: string | null;
  beforeValue?: string | null;
  afterValue?: string | null;
  sourceId: string;
}): UpdateHistoryInsert {
  return {
    historyId: crypto.randomUUID(),
    updateKey: input.updateKey,
    productId: input.productId,
    fieldName: input.fieldName,
    vendorName: input.vendorName ?? null,
    beforeValue: input.beforeValue ?? null,
    afterValue: input.afterValue ?? null,
    sourceType: "PDF",
    sourceId: input.sourceId,
    updatedAt: new Date(),
    updatedBy: "SYSTEM",
  };
}

function isNewerInvoiceDate(
  invoiceDate: string | null,
  priceUpdatedOn: string | null,
): boolean {
  if (!invoiceDate) return false;
  if (!priceUpdatedOn) return true;
  return invoiceDate > priceUpdatedOn;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

function computeSystemConfidence(input: {
  modelConfidence: number | null;
  quantity: number | null;
  unitPrice: number | null;
  amount: number | null;
  productName: string;
  spec: string | null;
}): number {
  let score = input.modelConfidence ?? 0.6;
  if (input.productName) {
    score += 0.05;
  }
  if (input.spec) {
    score += 0.05;
  }
  if (input.quantity !== null && input.unitPrice !== null && input.amount !== null) {
    const expected = input.quantity * input.unitPrice;
    const tolerance = Math.max(1, Math.abs(input.amount) * 0.02);
    if (Math.abs(expected - input.amount) <= tolerance) {
      score += 0.1;
    } else {
      score -= 0.1;
    }
  }
  return clamp(score, 0, 1);
}

async function getDocumentRow(documentId: string): Promise<DocumentRow | null> {
  const db = getDb();
  const [row] = await db
    .select({
      documentId: documents.documentId,
      storageKey: documents.storageKey,
      isDeleted: documents.isDeleted,
    })
    .from(documents)
    .where(eq(documents.documentId, documentId))
    .limit(1);
  return row ?? null;
}

async function failParseRun(input: {
  documentId: string;
  parseRunId: string;
  errorDetail: string;
  summary: string;
  stats: Record<string, unknown>;
}) {
  const db = getDb();
  await db.transaction(async (tx) => {
    await tx
      .update(documentParseRuns)
      .set({
        status: "FAILED",
        finishedAt: new Date(),
        errorDetail: input.errorDetail,
        stats: input.stats,
      })
      .where(eq(documentParseRuns.parseRunId, input.parseRunId));
    await tx
      .update(documents)
      .set({ status: "FAILED", parseErrorSummary: input.summary })
      .where(eq(documents.documentId, input.documentId));
  });
}

export async function parseDocument(
  documentId: string,
): Promise<ParseDocumentResult> {
  const documentRow = await getDocumentRow(documentId);
  if (!documentRow || documentRow.isDeleted) {
    throw new Error("Document not found");
  }

  const env = getEnv();
  const envModel = env.GEMINI_MODEL;
  const model = envModel && envModel.trim() ? envModel : "gemini-1.5-flash";
  const parseRunId = crypto.randomUUID();

  const db = getDb();
  await db.transaction(async (tx) => {
    const parseRunRow = buildParseRunRow({
      parseRunId,
      documentId,
      model,
      stats: {},
    });
    await tx.insert(documentParseRuns).values(parseRunRow);

    await tx
      .update(documents)
      .set({ status: "PARSING", parseErrorSummary: null })
      .where(eq(documents.documentId, documentId));
  });

  let invoiceData;
  const pageCount = 1;
  try {
    const storage = getStorageProvider();
    if (!storage.getDownloadUrl) {
      throw new Error("Storage provider does not support download");
    }
    const url = await storage.getDownloadUrl(documentRow.storageKey);
    const headers: Record<string, string> = {};
    if (env.BLOB_READ_WRITE_TOKEN) {
      headers.authorization = `Bearer ${env.BLOB_READ_WRITE_TOKEN}`;
    }
    const pdfResponse = await fetch(url, { headers });
    if (!pdfResponse.ok) {
      throw new Error("Failed to download PDF");
    }
    const buffer = Buffer.from(await pdfResponse.arrayBuffer());
    assertSinglePagePdf(buffer);
    invoiceData = await parseInvoiceFromPdf(buffer.toString("base64"));

    console.info("document_parse_pages", {
      documentId,
      parseRunId,
      pageCount,
    });
  } catch (error) {
    const detail =
      error instanceof Error &&
      error.message.startsWith("MULTI_PAGE_DOCUMENT_NOT_ALLOWED")
        ? error.message
        : "PARSE_ERROR";
    const summary =
      detail === "PARSE_ERROR"
        ? "解析に失敗しました。"
        : "1ページPDFのみ解析可能です。アップロードをやり直してください。";
    await failParseRun({
      documentId,
      parseRunId,
      errorDetail: detail,
      summary,
      stats: {
        pageCount,
        processedPages: 0,
      },
    });
    throw error;
  }

  const rawLineItemCount = invoiceData.lineItems.length;
  console.info("document_parse_result", {
    documentId,
    parseRunId,
    vendorName: invoiceData.vendorName ?? null,
    invoiceDate: invoiceData.invoiceDate ?? null,
    lineItemCount: rawLineItemCount,
  });

  if (rawLineItemCount === 0) {
    await failParseRun({
      documentId,
      parseRunId,
      errorDetail: noLineItemsErrorCode,
      summary: noLineItemsSummary,
      stats: {
        rawLineItemCount: 0,
        lineItemCount: 0,
        diffCount: 0,
        pageCount,
        processedPages: 1,
      },
    });

    throw new Error(noLineItemsErrorCode);
  }

  const vendorName = invoiceData.vendorName ? normalizeText(invoiceData.vendorName) : null;
  const invoiceDate =
    invoiceData.invoiceDate && dateRegex.test(invoiceData.invoiceDate)
      ? invoiceData.invoiceDate
      : null;

  await db.transaction(async (tx) => {
    const productKeySet = new Set<string>();
    invoiceData.lineItems.forEach((item) => {
      const productMaker = item.productMaker ? normalizeText(item.productMaker) : null;
      const name = sanitizeProductName({
        productName: item.productName ?? "",
        productMaker,
      });
      if (!name) return;
      const spec = item.spec ?? null;
      const key = makeProductKey(name, spec, productMaker);
      const legacyKey = makeProductKey(name, spec);
      if (key) productKeySet.add(key);
      if (legacyKey) productKeySet.add(legacyKey);
    });
    const productKeys = Array.from(productKeySet);

    const productRows = productKeys.length
      ? await tx
          .select({
            productId: productMaster.productId,
            productKey: productMaster.productKey,
            productMaker: productMaster.productMaker,
            productName: productMaster.productName,
            spec: productMaster.spec,
            category: productMaster.category,
            defaultUnitPrice: productMaster.defaultUnitPrice,
            qualityFlag: productMaster.qualityFlag,
          })
          .from(productMaster)
          .orderBy(desc(productMaster.lastUpdatedAt), asc(productMaster.productId))
          .where(inArray(productMaster.productKey, productKeys))
      : [];

    const productMap = new Map<
      string,
      {
        productId: string;
        productKey: string;
        productMaker: string | null;
        productName: string;
        spec: string | null;
        category: string | null;
        defaultUnitPrice: string | null;
        qualityFlag: string;
      }
    >();
    for (const row of productRows) {
      if (productMap.has(row.productKey)) continue;
      productMap.set(row.productKey, {
        productId: row.productId,
        productKey: row.productKey,
        productMaker: row.productMaker ?? null,
        productName: row.productName,
        spec: row.spec ?? null,
        category: row.category ?? null,
        defaultUnitPrice: row.defaultUnitPrice ?? null,
        qualityFlag: row.qualityFlag,
      });
    }

    const lineContexts: LineItemContext[] = [];

    invoiceData.lineItems.forEach((item, index) => {
      const productMaker = item.productMaker ? normalizeText(item.productMaker) : null;
      const productNameRaw = sanitizeProductName({
        productName: item.productName ?? "",
        productMaker,
      });
      if (!productNameRaw) return;
      const specRaw = item.spec ? normalizeText(item.spec) : null;
      const productKeyCandidate = makeProductKey(productNameRaw, specRaw, productMaker);
      const legacyProductKeyCandidate = makeProductKey(productNameRaw, specRaw);
      if (!productKeyCandidate) return;
      const quantity = toNumericString(item.quantity, 3);
      const unitPrice = toNumericString(item.unitPrice, 2);
      const amount = toNumericString(item.amount, 2);
      const modelConfidenceNum = safeParseFloat(item.confidence);
      const modelConfidence = toNumericString(modelConfidenceNum, 3);
      const systemConfidenceNum = computeSystemConfidence({
        modelConfidence: modelConfidenceNum,
        quantity: safeParseFloat(item.quantity),
        unitPrice: safeParseFloat(item.unitPrice),
        amount: safeParseFloat(item.amount),
        productName: productNameRaw,
        spec: specRaw,
      });
      const systemConfidence = toNumericString(systemConfidenceNum, 3);
      const matched =
        productMap.get(productKeyCandidate) ?? productMap.get(legacyProductKeyCandidate);
      lineContexts.push({
        lineItemId: crypto.randomUUID(),
        lineNo: item.lineNo ?? index + 1,
        productMaker,
        productNameRaw,
        specRaw,
        productKeyCandidate,
        legacyProductKeyCandidate,
        quantity,
        unitPrice,
        amount,
        modelConfidence,
        systemConfidence,
        systemConfidenceNum,
        matchedProductId: matched?.productId ?? null,
        matchedProductSpec: matched?.spec ?? null,
        matchedProductCategory: matched?.category ?? null,
      });
    });

    console.info("document_parse_normalized", {
      documentId,
      parseRunId,
      rawLineItemCount,
      lineItemCount: lineContexts.length,
    });

    if (lineContexts.length === 0) {
      await tx
        .update(documentParseRuns)
        .set({
          status: "FAILED",
          finishedAt: new Date(),
          errorDetail: noUsableLineItemsErrorCode,
          stats: {
            rawLineItemCount,
            lineItemCount: 0,
            diffCount: 0,
            pageCount,
            processedPages: 1,
          },
        })
        .where(eq(documentParseRuns.parseRunId, parseRunId));
      await tx
        .update(documents)
        .set({ status: "FAILED", parseErrorSummary: noUsableLineItemsSummary })
        .where(eq(documents.documentId, documentId));
      return;
    }

    const lineItemRows = lineContexts.map((context) =>
      buildLineItemRow({ ...context, parseRunId }),
    );
    if (lineItemRows.length) {
      await tx.insert(documentLineItems).values(lineItemRows);
    }
    console.info("document_parse_line_items_inserted", {
      documentId,
      parseRunId,
      count: lineItemRows.length,
    });

    const matchedProductIds = lineContexts
      .map((context) => context.matchedProductId)
      .filter((id): id is string => Boolean(id));

    const vendorRows: VendorPriceRow[] =
      matchedProductIds.length && vendorName
        ? await tx
            .select({
              vendorPriceId: vendorPrices.vendorPriceId,
              productId: vendorPrices.productId,
              unitPrice: vendorPrices.unitPrice,
              priceUpdatedOn: vendorPrices.priceUpdatedOn,
            })
            .from(vendorPrices)
            .where(
              and(
                inArray(vendorPrices.productId, matchedProductIds),
                eq(vendorPrices.vendorName, vendorName),
              ),
            )
        : [];

    const vendorMap = new Map(vendorRows.map((row) => [row.productId, row]));

    const diffRows: DiffItemInsert[] = [];

    for (const context of lineContexts) {
      const before: Record<string, unknown> = {};
      const after: Record<string, unknown> = {
        productName: context.productNameRaw,
        productMaker: context.productMaker,
        spec: context.specRaw,
        productKeyCandidate: context.productKeyCandidate,
        unitPrice: context.unitPrice,
        amount: context.amount,
      };

      if (!context.matchedProductId) {
        const confidence = context.systemConfidenceNum;
        const canCreateCandidate = confidence !== null && confidence >= 0.9;
        diffRows.push(
          buildDiffItemRow({
            diffItemId: crypto.randomUUID(),
            parseRunId,
            lineItemId: context.lineItemId,
            classification: canCreateCandidate ? "NEW_CANDIDATE" : "UNMATCHED",
            reason: canCreateCandidate
              ? "REVIEW_REQUIRED_BEFORE_PRODUCT_CREATE"
              : "NO_PRODUCT_MATCH",
            vendorName,
            invoiceDate,
            before,
            after,
          }),
        );
        continue;
      }

      const existingVendor = vendorMap.get(context.matchedProductId) ?? null;
      const existingUnitPrice = existingVendor?.unitPrice ?? null;
      const existingUnitPriceNum = safeParseFloat(existingUnitPrice);
      const newUnitPriceNum = safeParseFloat(context.unitPrice);
      const hasPriceChange =
        newUnitPriceNum !== null &&
        (existingUnitPriceNum === null || newUnitPriceNum !== existingUnitPriceNum);

      const hasSpecChange =
        context.specRaw !== null &&
        context.specRaw.trim() !== "" &&
        context.specRaw !== (context.matchedProductSpec ?? null);

      const priceDeviation =
        existingUnitPriceNum !== null && newUnitPriceNum !== null && existingUnitPriceNum > 0
          ? Math.abs(newUnitPriceNum - existingUnitPriceNum) / existingUnitPriceNum
          : existingUnitPriceNum === null && newUnitPriceNum !== null
            ? 0
            : hasPriceChange
              ? null
              : 0;

      const requiresUpdate = hasPriceChange || hasSpecChange;
      const policy = requiresUpdate
        ? shouldBlockUpdate({
            systemConfidenceNum: context.systemConfidenceNum,
            vendorName,
            unitPriceNum: hasPriceChange
              ? newUnitPriceNum
              : (existingUnitPriceNum ?? newUnitPriceNum),
            keyIsWeak: !context.specRaw,
            deviation: hasPriceChange ? priceDeviation : 0,
          })
        : { blocked: false };

      if (existingVendor) {
        before.unitPrice = existingVendor.unitPrice;
        before.priceUpdatedOn = existingVendor.priceUpdatedOn;
      }
      before.productId = context.matchedProductId;
      before.spec = context.matchedProductSpec;
      before.category = context.matchedProductCategory;

      let classification = "NO_CHANGE";
      if (requiresUpdate) {
        classification = policy.blocked ? "BLOCKED" : "UPDATE";
      }

      diffRows.push(
        buildDiffItemRow({
          diffItemId: crypto.randomUUID(),
          parseRunId,
          lineItemId: context.lineItemId,
          classification,
          reason: policy.reason,
          vendorName,
          invoiceDate,
          before,
          after,
        }),
      );

      if (policy.blocked) continue;

      if (hasSpecChange) {
        const historyRow = buildUpdateHistoryRow({
          updateKey: `${parseRunId}:${context.matchedProductId}:spec`,
          productId: context.matchedProductId,
          fieldName: "spec",
          vendorName,
          beforeValue: context.matchedProductSpec ?? null,
          afterValue: context.specRaw,
          sourceId: parseRunId,
        });

        await tx.insert(updateHistory).values(historyRow);
        await tx
          .update(productMaster)
          .set({
            spec: context.specRaw,
            lastUpdatedAt: new Date(),
            lastSourceType: "PDF",
            lastSourceId: parseRunId,
          })
          .where(eq(productMaster.productId, context.matchedProductId));
      }

      if (hasPriceChange && context.unitPrice) {
        if (!vendorName) continue;
        const canUpdateByDate = isNewerInvoiceDate(
          invoiceDate,
          existingVendor?.priceUpdatedOn ?? null,
        );
        let updated = false;
        if (existingVendor) {
          if (canUpdateByDate) {
            await tx
              .update(vendorPrices)
              .set({
                unitPrice: context.unitPrice,
                priceUpdatedOn: invoiceDate,
                sourceType: "PDF",
                sourceId: parseRunId,
                updatedAt: new Date(),
              })
              .where(eq(vendorPrices.vendorPriceId, existingVendor.vendorPriceId));
            updated = true;
          }
        } else {
          const vendorRow = buildVendorPriceRow({
            vendorPriceId: crypto.randomUUID(),
            productId: context.matchedProductId,
            vendorName,
            unitPrice: context.unitPrice,
            priceUpdatedOn: invoiceDate,
            sourceId: parseRunId,
          });
          await tx.insert(vendorPrices).values(vendorRow);
          updated = true;
        }

        if (updated) {
          const historyRow = buildUpdateHistoryRow({
            updateKey: `${parseRunId}:${context.matchedProductId}:unit_price`,
            productId: context.matchedProductId,
            fieldName: "unit_price",
            vendorName,
            beforeValue: existingVendor?.unitPrice ?? null,
            afterValue: context.unitPrice,
            sourceId: parseRunId,
          });
          await tx.insert(updateHistory).values(historyRow);
        }
      }
    }

    if (diffRows.length) {
      await tx.insert(documentDiffItems).values(diffRows);
    }
    console.info("document_parse_diff_items_inserted", {
      documentId,
      parseRunId,
      count: diffRows.length,
    });

    await tx
      .update(documents)
      .set({
        status: "PARSED",
        vendorName,
        invoiceDate,
        parseErrorSummary: null,
      })
      .where(eq(documents.documentId, documentId));

    await tx
      .update(documentParseRuns)
      .set({
        status: "SUCCEEDED",
        finishedAt: new Date(),
        stats: {
          rawLineItemCount,
          lineItemCount: lineContexts.length,
          diffCount: diffRows.length,
          pageCount,
          processedPages: 1,
          newCandidateCount: diffRows.filter((row) => row.classification === "NEW_CANDIDATE").length,
          unmatchedCount: diffRows.filter((row) => row.classification === "UNMATCHED").length,
        },
      })
      .where(eq(documentParseRuns.parseRunId, parseRunId));

    console.info("document_parse_completed", {
      documentId,
      parseRunId,
      status: "SUCCEEDED",
      lineItemCount: lineContexts.length,
      diffCount: diffRows.length,
    });
  });

  return { parseRunId, status: "SUCCEEDED" };
}
