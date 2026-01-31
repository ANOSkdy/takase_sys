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

  console.log("OK: required tables exist.");
} finally {
  await sql.end({ timeout: 5 });
}
