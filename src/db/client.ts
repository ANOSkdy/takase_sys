import postgres, { type Sql } from "postgres";
import { drizzle, type PostgresJsDatabase } from "drizzle-orm/postgres-js";
import { getEnv, requireEnv } from "@/config/env";
import * as schema from "@/db/schema";

/**
 * NOTE:
 * - create client lazily (do not require env at import time)
 * - server-only: getEnv() already throws if executed on client
 */
type Db = PostgresJsDatabase<typeof schema>;

type GlobalCache = {
  __sql?: Sql;
  __db?: Db;
};

const globalForDb = globalThis as unknown as GlobalCache;

export function getSql(): Sql {
  if (globalForDb.__sql) return globalForDb.__sql;

  const env = getEnv();
  const url = requireEnv(env.DATABASE_URL, "DATABASE_URL");

  // Neon often uses poolers; prepared statements can be problematic in transaction pooling.
  // Keep the pool small to avoid exhausting connections in serverless environments.
  const sql = postgres(url, {
    max: 1,
    idle_timeout: 20,
    max_lifetime: 60 * 30,
    prepare: false,
  });

  globalForDb.__sql = sql;
  return sql;
}

export function getDb(): Db {
  if (globalForDb.__db) return globalForDb.__db;
  const db = drizzle(getSql(), { schema });
  globalForDb.__db = db;
  return db;
}
