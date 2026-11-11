import "server-only";
import { getSql } from "@/db/client";
import type { ProductSource, ProductSourceSummary } from "@/services/products/types";

type SourceDbRow = {
  productId: string;
  lineItemId: string;
  lineNo: number | null;
  linkedAt: string | Date | null;
  linkMethod: string;
  attentionReason: string | null;
  documentId: string;
  fileName: string;
  pageNumber: number | null;
  invoiceDate: string | Date | null;
  documentDeleted: boolean;
  deletedReason: string | null;
};

type SummaryDbRow = SourceDbRow & { sourceCount: string | number };

function toDateOnly(value: string | Date | null): string | null {
  if (!value) return null;
  if (typeof value === "string") return value.slice(0, 10);
  return value.toISOString().slice(0, 10);
}

function toIso(value: string | Date | null): string | null {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function toSource(row: SourceDbRow): ProductSource {
  return {
    lineItemId: row.lineItemId,
    lineNo: row.lineNo ?? null,
    linkedAt: toIso(row.linkedAt),
    linkMethod: row.linkMethod,
    attentionReason: row.attentionReason ?? null,
    documentId: row.documentId,
    fileName: row.fileName,
    pageNumber: row.pageNumber ?? null,
    invoiceDate: toDateOnly(row.invoiceDate),
    documentDeleted: row.documentDeleted,
    deletedReason: row.deletedReason ?? null,
  };
}

// 出典は product_document_sources → document_line_items → document_parse_runs → documents
// の順にたどる。storage_key（PDFの実体URL）はここでは取得せず、クライアントへ渡さない。

/** 商品ごとの代表出典（最初に紐付いた明細）と出典件数。一覧表示用。 */
export async function getProductSourceSummaries(
  productIds: string[],
): Promise<Map<string, ProductSourceSummary>> {
  const result = new Map<string, ProductSourceSummary>();
  if (productIds.length === 0) return result;

  const sql = getSql();
  const rows = await sql<SummaryDbRow[]>`
    SELECT DISTINCT ON (pds.product_id)
      pds.product_id AS "productId",
      COUNT(*) OVER (PARTITION BY pds.product_id) AS "sourceCount",
      pds.line_item_id AS "lineItemId",
      li.line_no AS "lineNo",
      pds.linked_at AS "linkedAt",
      pds.link_method AS "linkMethod",
      pds.attention_reason AS "attentionReason",
      d.document_id AS "documentId",
      d.file_name AS "fileName",
      d.page_number AS "pageNumber",
      d.invoice_date AS "invoiceDate",
      d.is_deleted AS "documentDeleted",
      d.deleted_reason AS "deletedReason"
    FROM product_document_sources pds
    JOIN document_line_items li ON li.line_item_id = pds.line_item_id
    JOIN document_parse_runs pr ON pr.parse_run_id = li.parse_run_id
    JOIN documents d ON d.document_id = pr.document_id
    WHERE pds.product_id = ANY(${productIds}::uuid[])
    ORDER BY pds.product_id, pds.linked_at ASC, pds.line_item_id ASC
  `;

  for (const row of rows) {
    result.set(row.productId, {
      sourceCount: Number(row.sourceCount),
      representative: toSource(row),
    });
  }
  return result;
}

/** 1商品の全出典（新しい紐付け順）。詳細表示用。 */
export async function listProductSources(productId: string): Promise<ProductSource[]> {
  const sql = getSql();
  const rows = await sql<SourceDbRow[]>`
    SELECT
      pds.product_id AS "productId",
      pds.line_item_id AS "lineItemId",
      li.line_no AS "lineNo",
      pds.linked_at AS "linkedAt",
      pds.link_method AS "linkMethod",
      pds.attention_reason AS "attentionReason",
      d.document_id AS "documentId",
      d.file_name AS "fileName",
      d.page_number AS "pageNumber",
      d.invoice_date AS "invoiceDate",
      d.is_deleted AS "documentDeleted",
      d.deleted_reason AS "deletedReason"
    FROM product_document_sources pds
    JOIN document_line_items li ON li.line_item_id = pds.line_item_id
    JOIN document_parse_runs pr ON pr.parse_run_id = li.parse_run_id
    JOIN documents d ON d.document_id = pr.document_id
    WHERE pds.product_id = ${productId}
    ORDER BY pds.linked_at DESC, pds.line_item_id ASC
  `;
  return rows.map(toSource);
}
