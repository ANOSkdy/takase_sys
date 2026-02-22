import { and, desc, eq, sql } from "drizzle-orm";
import { getDb } from "@/db/client";
import { documentDiffItems, documentLineItems, documentParseRuns, documents } from "@/db/schema";
import type {
  DocumentDetail,
  DocumentDiffItem,
  DocumentLineItem,
  DocumentListItem,
  RegisterDocumentInput,
  RegisterDocumentBulkInput,
  RegisterDocumentBulkResult,
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

export async function listDocuments(): Promise<DocumentListItem[]> {
  const db = getDb();
  const fetchRows = async () =>
    db
      .select({
        documentId: documents.documentId,
        fileName: documents.fileName,
        uploadGroupId: documents.uploadGroupId,
        pageNumber: documents.pageNumber,
        pageTotal: documents.pageTotal,
        sourceFileHash: documents.sourceFileHash,
        uploadedAt: documents.uploadedAt,
        status: documents.status,
        vendorName: documents.vendorName,
        invoiceDate: documents.invoiceDate,
        uploadNote: documents.uploadNote,
      })
      .from(documents)
      .where(eq(documents.isDeleted, false))
      .orderBy(
        desc(documents.uploadedAt),
        documents.uploadGroupId,
        documents.pageNumber,
        documents.documentId,
      );

  const fetchLegacyRows = async () =>
    db
      .select({
        documentId: documents.documentId,
        fileName: documents.fileName,
        uploadGroupId: sql<string | null>`null`.as("upload_group_id"),
        pageNumber: sql<number | null>`null`.as("page_number"),
        pageTotal: sql<number | null>`null`.as("page_total"),
        sourceFileHash: sql<string | null>`null`.as("source_file_hash"),
        uploadedAt: documents.uploadedAt,
        status: documents.status,
        vendorName: documents.vendorName,
        invoiceDate: documents.invoiceDate,
        uploadNote: documents.uploadNote,
      })
      .from(documents)
      .where(eq(documents.isDeleted, false))
      .orderBy(desc(documents.uploadedAt), documents.documentId);

  let rows;
  try {
    rows = await fetchRows();
  } catch (error) {
    const isMissingColumn =
      typeof error === "object" &&
      error !== null &&
      "code" in error &&
      (error as { code?: string }).code === "42703";
    if (!isMissingColumn) throw error;
    console.warn("[documents] page metadata columns missing; falling back to legacy schema");
    rows = await fetchLegacyRows();
  }

  return rows.map((row) => ({
    documentId: row.documentId,
    fileName: row.fileName,
    uploadGroupId: row.uploadGroupId ?? null,
    pageNumber: row.pageNumber ?? null,
    pageTotal: row.pageTotal ?? null,
    sourceFileHash: row.sourceFileHash ?? null,
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
      uploadGroupId: documents.uploadGroupId,
      pageNumber: documents.pageNumber,
      pageTotal: documents.pageTotal,
      sourceFileHash: documents.sourceFileHash,
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
      errorDetail: documentParseRuns.errorDetail,
    })
    .from(documentParseRuns)
    .where(eq(documentParseRuns.documentId, documentId))
    .orderBy(desc(documentParseRuns.startedAt))
    .limit(1);

  return {
    documentId: doc.documentId,
    fileName: doc.fileName,
    uploadGroupId: doc.uploadGroupId ?? null,
    pageNumber: doc.pageNumber ?? null,
    pageTotal: doc.pageTotal ?? null,
    sourceFileHash: doc.sourceFileHash ?? null,
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
          status: latestRun.status,
          startedAt: toIsoString(latestRun.startedAt) ?? "",
          finishedAt: toIsoString(latestRun.finishedAt),
          errorDetail: latestRun.errorDetail ?? null,
        }
      : null,
  };
}

export async function registerDocumentBulk(
  input: RegisterDocumentBulkInput,
): Promise<RegisterDocumentBulkResult> {
  const db = getDb();
  const uploadGroupId = crypto.randomUUID();

  const items = await db.transaction(async (tx) => {
    const rows = await tx
      .insert(documents)
      .values(
        input.pages.map((page) => ({
          fileName: input.fileName,
          storageKey: page.storageKey,
          fileHash: page.fileHash,
          uploadNote: input.uploadNote ?? null,
          uploadGroupId,
          pageNumber: page.pageNumber,
          pageTotal: page.pageTotal,
          sourceFileHash: input.sourceFileHash ?? null,
        })),
      )
      .returning({
        documentId: documents.documentId,
        pageNumber: documents.pageNumber,
        status: documents.status,
      });

    return rows
      .map((row) => ({
        documentId: row.documentId,
        pageNumber: row.pageNumber ?? 1,
        status: row.status as RegisterDocumentBulkResult["items"][number]["status"],
      }))
      .sort((a, b) => a.pageNumber - b.pageNumber);
  });

  return { uploadGroupId, items };
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
