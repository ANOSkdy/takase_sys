import "server-only";
import { z } from "zod";
import { getSql } from "@/db/client";
import { assertNoDateSqlParams } from "@/db/sql-params";

const pageAssetSchema = z.object({
  documentId: z.string().uuid(),
  pageNo: z.number().int().positive(),
  storageKey: z.string().min(1).max(1024),
  pageHash: z.string().length(64),
  byteSize: z.number().int().positive(),
  mimeType: z.string().min(1).max(255),
});

export type DocumentPageAsset = {
  pageNo: number;
  storageKey: string;
  pageHash: string;
  byteSize: number;
  mimeType: string;
};

export async function listPageAssets(documentId: string): Promise<DocumentPageAsset[]> {
  const id = z.string().uuid().parse(documentId);
  const sql = getSql();
  const rows = await sql.unsafe<
    { page_no: number; storage_key: string; page_hash: string; byte_size: number; mime_type: string }[]
  >(
    `
      SELECT page_no, storage_key, page_hash, byte_size, mime_type
      FROM document_page_assets
      WHERE document_id = $1
      ORDER BY page_no ASC
    `,
    [id],
  );

  return rows.map((row) => ({
    pageNo: row.page_no,
    storageKey: row.storage_key,
    pageHash: row.page_hash,
    byteSize: row.byte_size,
    mimeType: row.mime_type,
  }));
}

export async function upsertPageAsset(
  documentId: string,
  pageNo: number,
  storageKey: string,
  pageHash: string,
  byteSize: number,
  mimeType: string,
): Promise<void> {
  const input = pageAssetSchema.parse({ documentId, pageNo, storageKey, pageHash, byteSize, mimeType });
  const sql = getSql();
  const params = [
    input.documentId,
    input.pageNo,
    input.storageKey,
    input.pageHash,
    input.byteSize,
    input.mimeType,
  ];
  assertNoDateSqlParams(params, "upsertPageAsset");

  await sql.unsafe(
    `
      INSERT INTO document_page_assets (
        document_id, page_no, storage_key, page_hash, byte_size, mime_type, updated_at
      ) VALUES ($1, $2, $3, $4, $5, $6, now())
      ON CONFLICT (document_id, page_no)
      DO UPDATE SET
        storage_key = EXCLUDED.storage_key,
        page_hash = EXCLUDED.page_hash,
        byte_size = EXCLUDED.byte_size,
        mime_type = EXCLUDED.mime_type,
        updated_at = now()
    `,
    params,
  );
}

export async function countPageAssets(documentId: string): Promise<number> {
  const id = z.string().uuid().parse(documentId);
  const sql = getSql();
  const rows = await sql.unsafe<{ count: string }[]>(
    `SELECT COUNT(*)::text AS count FROM document_page_assets WHERE document_id = $1`,
    [id],
  );
  return Number(rows[0]?.count ?? "0");
}
