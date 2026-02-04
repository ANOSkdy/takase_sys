import pg from "pg";

const { Client } = pg;

const DATABASE_URL = process.env.DATABASE_URL;
const DOC_ID = process.env.DOC_ID;
const BLOB_URL = process.env.BLOB_URL;

if (!DATABASE_URL) throw new Error("Missing DATABASE_URL");
if (!DOC_ID) throw new Error("Missing DOC_ID");
if (!BLOB_URL) throw new Error("Missing BLOB_URL");

const client = new Client({ connectionString: DATABASE_URL });

async function main() {
  await client.connect();

  const updateSql = `
    update documents
       set storage_key = $1,
           status = $2
     where document_id = $3
  `;
  const updateParams = [BLOB_URL, "UPLOADED", DOC_ID];
  const updated = await client.query(updateSql, updateParams);

  const selectSql = `select document_id, status, storage_key from documents where document_id = $1`;
  const selected = await client.query(selectSql, [DOC_ID]);

  console.log("updated rows:", updated.rowCount);
  console.log("row:", selected.rows[0] ?? null);

  await client.end();
}

main().catch(async (e) => {
  console.error("ERROR:", e?.message ?? e);
  try { await client.end(); } catch {}
  process.exit(1);
});
