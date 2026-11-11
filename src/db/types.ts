import type { PgDatabase, PgQueryResultHKT } from "drizzle-orm/pg-core";
import type * as schema from "@/db/schema";

/**
 * ドライバに依存しないDB（またはトランザクション）の型。
 * 本番の postgres-js と、テストのインメモリPostgres（PGlite）の両方を受け取れる。
 */
export type AppDb<H extends PgQueryResultHKT = PgQueryResultHKT> = PgDatabase<H, typeof schema>;
