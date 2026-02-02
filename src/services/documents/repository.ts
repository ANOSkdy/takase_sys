import { desc, eq } from "drizzle-orm";
import { getDb } from "@/db/client";
import { documentParseRuns, documents } from "@/db/schema";
import type {
  DocumentDetail,
  DocumentListItem,
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
          status: latestRun.status,
          startedAt: toIsoString(latestRun.startedAt) ?? "",
          finishedAt: toIsoString(latestRun.finishedAt),
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
