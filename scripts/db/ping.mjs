import postgres from "postgres";

const url = process.env.DATABASE_URL_UNPOOLED;
if (!url) {
  console.error("DATABASE_URL_UNPOOLED is required.");
  process.exit(1);
}

const sql = postgres(url, { max: 1, prepare: false });

try {
  const r = await sql`select 1 as ok`;
  console.log(r);
} finally {
  await sql.end({ timeout: 5 });
}
