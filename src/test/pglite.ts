import { readFileSync } from "node:fs";
import path from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { pgcrypto } from "@electric-sql/pglite/contrib/pgcrypto";
import { drizzle } from "drizzle-orm/pglite";
import * as schema from "@/db/schema";

// 本番と同じ手動実行用SQLをそのまま流す。Drizzle定義とのずれや制約違反をテストで検出できる。
const SCHEMA_FILES = [
  "db/schema/v1.sql",
  "db/schema/v2_documents_page_split.sql",
  "db/schema/v3_product_review.sql",
];

// 実DBには存在するが、リポジトリのSQLスナップショットに含まれていない列
// （2026-11-11 に実DBの information_schema と照合）。スナップショットが整備されたら削除する。
const UNSNAPSHOTTED_COLUMNS_SQL = `
  ALTER TABLE product_master
    ADD COLUMN IF NOT EXISTS product_maker text,
    ADD COLUMN IF NOT EXISTS product_canonical_key text;
  ALTER TABLE document_line_items
    ADD COLUMN IF NOT EXISTS product_maker text;
`;

const TABLES = [
  "product_review_history",
  "product_document_sources",
  "update_history",
  "document_diff_items",
  "document_line_items",
  "document_parse_runs",
  "documents",
  "vendor_prices",
  "product_master",
];

/** インメモリのPostgres（PGlite）に実スキーマを適用したテスト用DB。外部DBには接続しない。 */
export async function createTestDb() {
  const client = new PGlite({ extensions: { pgcrypto } });
  for (const file of SCHEMA_FILES) {
    const sql = readFileSync(path.resolve(process.cwd(), file), "utf8").replace(/^﻿/, "");
    await client.exec(sql);
    if (file === "db/schema/v1.sql") await client.exec(UNSNAPSHOTTED_COLUMNS_SQL);
  }
  const db = drizzle(client, { schema });

  return {
    client,
    db,
    async reset() {
      await client.exec(`TRUNCATE ${TABLES.join(", ")} CASCADE`);
    },
    async rows<T = Record<string, unknown>>(sql: string, params: unknown[] = []): Promise<T[]> {
      const result = await client.query<T>(sql, params);
      return result.rows;
    },
    async close() {
      await client.close();
    },
  };
}

export type TestDb = Awaited<ReturnType<typeof createTestDb>>;
