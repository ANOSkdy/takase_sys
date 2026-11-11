import postgres from "postgres";

const requiredTables = [
  "product_master",
  "vendor_prices",
  "documents",
  "document_parse_runs",
  "document_line_items",
  "document_diff_items",
  "update_history",
  "excel_import_runs",
  // v3 (db/schema/v3_product_review.sql)
  "product_document_sources",
  "product_review_history",
];

const requiredDocumentColumns = [
  "upload_group_id",
  "page_number",
  "page_total",
  "source_file_hash",
];

// v3 (db/schema/v3_product_review.sql)
const requiredProductMasterColumns = [
  "review_status",
  "reviewed_at",
  "reviewed_by",
  "merged_into_product_id",
];

const requiredProductMasterConstraints = [
  "chk_product_master_review_status",
  "chk_product_master_merge_target",
];

const url = process.env.DATABASE_URL_UNPOOLED || process.env.DATABASE_URL;
if (!url) {
  console.error("DATABASE_URL(_UNPOOLED) is required to verify schema.");
  process.exit(1);
}

const sql = postgres(url, { max: 1, prepare: false });

try {
  const rows = await sql`
    select tablename
    from pg_tables
    where schemaname = 'public'
  `;
  const tableSet = new Set(rows.map((r) => r.tablename));
  const missing = requiredTables.filter((t) => !tableSet.has(t));

  if (missing.length) {
    console.error("Missing tables:", missing.join(", "));
    process.exit(2);
  }

  const documentColumns = await sql`
    select column_name
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'documents'
  `;
  const columnSet = new Set(documentColumns.map((row) => row.column_name));
  const missingColumns = requiredDocumentColumns.filter((column) => !columnSet.has(column));
  if (missingColumns.length) {
    console.error("Missing documents columns:", missingColumns.join(", "));
    process.exit(3);
  }

  const productColumns = await sql`
    select column_name
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'product_master'
  `;
  const productColumnSet = new Set(productColumns.map((row) => row.column_name));
  const missingProductColumns = requiredProductMasterColumns.filter(
    (column) => !productColumnSet.has(column),
  );
  if (missingProductColumns.length) {
    console.error("Missing product_master columns:", missingProductColumns.join(", "));
    process.exit(4);
  }

  const productConstraints = await sql`
    select conname
    from pg_constraint
    where conrelid = 'public.product_master'::regclass
  `;
  const constraintSet = new Set(productConstraints.map((row) => row.conname));
  const missingConstraints = requiredProductMasterConstraints.filter(
    (name) => !constraintSet.has(name),
  );
  if (missingConstraints.length) {
    console.error("Missing product_master constraints:", missingConstraints.join(", "));
    process.exit(5);
  }

  console.log("OK: required tables/columns exist.");
} finally {
  await sql.end({ timeout: 5 });
}
