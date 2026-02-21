import fs from "node:fs/promises";
import path from "node:path";
import postgres from "postgres";

const url = process.env.DATABASE_URL_UNPOOLED || process.env.DATABASE_URL;
if (!url) {
  console.error("DATABASE_URL(_UNPOOLED) is required to run migrations.");
  process.exit(1);
}

const migrationsDir = path.resolve("src/db/migrations");
const entries = (await fs.readdir(migrationsDir, { withFileTypes: true }))
  .filter((entry) => entry.isFile() && entry.name.endsWith(".sql"))
  .map((entry) => entry.name)
  .sort();

const sql = postgres(url, { max: 1, prepare: false });

try {
  for (const name of entries) {
    const file = path.join(migrationsDir, name);
    const migrationSql = await fs.readFile(file, "utf8");
    if (!migrationSql.trim()) continue;
    console.log(`[db:migrate] applying ${name}`);
    await sql.unsafe(migrationSql);
  }
  console.log("[db:migrate] done");
} finally {
  await sql.end({ timeout: 5 });
}
