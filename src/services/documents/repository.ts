import { and, desc, eq } from "drizzle-orm";
import { getDb } from "@/db/client";
import { documentDiffItems, documentLineItems, documentParseRuns, documents } from "@/db/schema";
import type {
  DocumentDetail,
  DocumentDiffItem,
  DocumentLineItem,
  DocumentListItem,
  ParseRunStats,
  ParseRunStatus,
  RegisterDocumentInput,
  RegisterDocumentResult,
  SoftDeleteResult,
} from "@/services/documents/types";

function toIsoString(value: Date | string | null): string | null {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return typeof value === "string" ? value : null;
  return date.toISOString();
}

function toDateString(value: Date | string | null): string | null {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return typeof value === "string" ? value : null;
  return date.toISOString().slice(0, 10);
}

function toParseRunStats(value: Record<string, unknown> | null | undefined): ParseRunStats | null {
  if (!value) return null;
  return {
    processedPages: typeof value.processedPages === "number" ? value.processedPages : undefined,
    succeededPages: typeof value.succeededPages === "number" ? value.succeededPages : undefined,
    failedPages: typeof value.failedPages === "number" ? value.failedPages : undefined,
    failedPageNos: Array.isArray(value.failedPageNos)
      ? value.failedPageNos.filter((pageNo): pageNo is number => typeof pageNo === "number")
      : undefined,
  };
}

export async function listDocuments(): Promise<DocumentListItem[]> {
  const db = getDb();
  const rows = await db
    .select({
      documentId: documents.documentId,
      fileName: documents.fileName,
      uploadedAt: documents.uploadedAt,
      status: documents.status,
      vendorName: documents.vendorName,
      invoiceDate: documents.invoiceDate,
      uploadNote: documents.uploadNote,
    })
    .from(documents)
    .where(eq(documents.isDeleted, false))
    .orderBy(desc(documents.uploadedAt));

  return rows.map((row) => ({
    documentId: row.documentId,
    fileName: row.fileName,
    uploadedAt: toIsoString(row.uploadedAt) ?? "",
    status: row.status as DocumentListItem["status"],
    vendorName: row.vendorName ?? null,
    invoiceDate: toDateString(row.invoiceDate),
    uploadNote: row.uploadNote ?? null,
  }));
}

export async function getDocumentDetail(documentId: string): Promise<DocumentDetail | null> {
  const db = getDb();
  const [doc] = await db
    .select({
      documentId: documents.documentId,
      fileName: documents.fileName,
      uploadedAt: documents.uploadedAt,
      status: documents.status,
      vendorName: documents.vendorName,
      invoiceDate: documents.invoiceDate,
      uploadNote: documents.uploadNote,
      fileHash: documents.fileHash,
      storageKey: documents.storageKey,
      parseErrorSummary: documents.parseErrorSummary,
      isDeleted: documents.isDeleted,
      deletedAt: documents.deletedAt,
      deletedReason: documents.deletedReason,
    })
    .from(documents)
    .where(eq(documents.documentId, documentId))
    .limit(1);

  if (!doc) return null;

  const [latestRun] = await db
    .select({
      parseRunId: documentParseRuns.parseRunId,
      status: documentParseRuns.status,
      startedAt: documentParseRuns.startedAt,
      finishedAt: documentParseRuns.finishedAt,
      stats: documentParseRuns.stats,
      errorDetail: documentParseRuns.errorDetail,
    })
    .from(documentParseRuns)
    .where(eq(documentParseRuns.documentId, documentId))
    .orderBy(desc(documentParseRuns.startedAt))
    .limit(1);

  return {
    documentId: doc.documentId,
    fileName: doc.fileName,
    uploadedAt: toIsoString(doc.uploadedAt) ?? "",
    status: doc.status as DocumentDetail["status"],
    vendorName: doc.vendorName ?? null,
    invoiceDate: toDateString(doc.invoiceDate),
    uploadNote: doc.uploadNote ?? null,
    fileHash: doc.fileHash,
    storageKey: doc.storageKey,
    parseErrorSummary: doc.parseErrorSummary ?? null,
    isDeleted: doc.isDeleted,
    deletedAt: toIsoString(doc.deletedAt),
    deletedReason: doc.deletedReason ?? null,
    latestParseRun: latestRun
      ? {
          parseRunId: latestRun.parseRunId,
          status: latestRun.status as ParseRunStatus,
          startedAt: toIsoString(latestRun.startedAt) ?? "",
          finishedAt: toIsoString(latestRun.finishedAt),
          stats: toParseRunStats(latestRun.stats),
          errorDetail: latestRun.errorDetail ?? null,
        }
      : null,
  };
}

export async function registerDocument(
  input: RegisterDocumentInput,
): Promise<RegisterDocumentResult> {
  const db = getDb();

  const existing = await db
    .select({ documentId: documents.documentId })
    .from(documents)
    .where(eq(documents.fileHash, input.fileHash))
    .limit(1);
  if (existing.length > 0) {
    console.warn("[documents] duplicate file hash detected", {
      existingDocumentId: existing[0].documentId,
    });
  }

  const [row] = await db
    .insert(documents)
    .values({
      fileName: input.fileName,
      storageKey: input.storageKey,
      fileHash: input.fileHash,
      uploadNote: input.uploadNote ?? null,
    })
    .returning({ documentId: documents.documentId, status: documents.status });

  return {
    documentId: row.documentId,
    status: row.status as RegisterDocumentResult["status"],
  };
}

export async function softDeleteDocument(
  documentId: string,
  deletedReason?: string | null,
): Promise<SoftDeleteResult | null> {
  const db = getDb();
  const [row] = await db
    .update(documents)
    .set({
      isDeleted: true,
      status: "DELETED",
      deletedAt: new Date(),
      deletedReason: deletedReason ?? null,
    })
    .where(eq(documents.documentId, documentId))
    .returning({ documentId: documents.documentId, status: documents.status });

  if (!row) return null;
  return {
    documentId: row.documentId,
    status: row.status as SoftDeleteResult["status"],
  };
}

async function getLatestParseRunId(documentId: string): Promise<string | null> {
  const db = getDb();
  const [row] = await db
    .select({ parseRunId: documentParseRuns.parseRunId })
    .from(documentParseRuns)
    .where(eq(documentParseRuns.documentId, documentId))
    .orderBy(desc(documentParseRuns.startedAt))
    .limit(1);
  return row?.parseRunId ?? null;
}

export async function listDocumentLineItems(
  documentId: string,
  parseRunId?: string | null,
): Promise<DocumentLineItem[]> {
  const resolvedParseRunId = parseRunId ?? (await getLatestParseRunId(documentId));
  if (!resolvedParseRunId) return [];
  const db = getDb();
  const rows = await db
    .select({
      lineItemId: documentLineItems.lineItemId,
      lineNo: documentLineItems.lineNo,
      productNameRaw: documentLineItems.productNameRaw,
      specRaw: documentLineItems.specRaw,
      productKeyCandidate: documentLineItems.productKeyCandidate,
      quantity: documentLineItems.quantity,
      unitPrice: documentLineItems.unitPrice,
      amount: documentLineItems.amount,
      modelConfidence: documentLineItems.modelConfidence,
      systemConfidence: documentLineItems.systemConfidence,
      matchedProductId: documentLineItems.matchedProductId,
    })
    .from(documentLineItems)
    .where(eq(documentLineItems.parseRunId, resolvedParseRunId))
    .orderBy(documentLineItems.lineNo);

  return rows.map((row) => ({
    lineItemId: row.lineItemId,
    lineNo: row.lineNo,
    productNameRaw: row.productNameRaw ?? null,
    specRaw: row.specRaw ?? null,
    productKeyCandidate: row.productKeyCandidate ?? null,
    quantity: row.quantity ?? null,
    unitPrice: row.unitPrice ?? null,
    amount: row.amount ?? null,
    modelConfidence: row.modelConfidence ?? null,
    systemConfidence: row.systemConfidence ?? null,
    matchedProductId: row.matchedProductId ?? null,
  }));
}

export async function listDocumentDiffItems(
  documentId: string,
  options?: { parseRunId?: string | null; classification?: string | null },
): Promise<DocumentDiffItem[]> {
  const resolvedParseRunId =
    options?.parseRunId ?? (await getLatestParseRunId(documentId));
  if (!resolvedParseRunId) return [];
  const db = getDb();
  const conditions = [eq(documentDiffItems.parseRunId, resolvedParseRunId)];
  if (options?.classification) {
    conditions.push(eq(documentDiffItems.classification, options.classification));
  }
  const rows = await db
    .select({
      diffItemId: documentDiffItems.diffItemId,
      lineItemId: documentDiffItems.lineItemId,
      classification: documentDiffItems.classification,
      reason: documentDiffItems.reason,
      vendorName: documentDiffItems.vendorName,
      invoiceDate: documentDiffItems.invoiceDate,
      before: documentDiffItems.before,
      after: documentDiffItems.after,
    })
    .from(documentDiffItems)
    .where(and(...conditions))
    .orderBy(documentDiffItems.diffItemId);

  return rows.map((row) => ({
    diffItemId: row.diffItemId,
    lineItemId: row.lineItemId,
    classification: row.classification,
    reason: row.reason ?? null,
    vendorName: row.vendorName ?? null,
    invoiceDate: toDateString(row.invoiceDate),
    before: row.before ?? {},
    after: row.after ?? {},
  }));
}
