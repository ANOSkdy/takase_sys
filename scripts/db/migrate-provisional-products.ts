/**
 * 解析済みの新規商品候補を仮登録へ移行する（手動実行用）。
 *
 * 既定はドライラン（同じ処理を実行して必ずロールバックする）。
 *
 *   ドライラン:
 *     pnpm db:migrate-provisional
 *   実行（ドライランで表示された「作成する仮登録商品」の件数を指定する）:
 *     pnpm db:migrate-provisional --execute --expect-created 66
 *
 * 接続先は DATABASE_URL_UNPOOLED。アプリのデプロイやビルドからは呼ばれない。
 * 詳細は docs/MIGRATION.md を参照。
 */
import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import * as schema from "@/db/schema";
import {
  formatMigrationReport,
  migrateProvisionalProducts,
} from "@/services/documents/provisional-migration";

// docs/PROVISIONAL_PRODUCT_IMPLEMENTATION_PLAN.md §9 の対象取込グループ。
const DEFAULT_UPLOAD_GROUP_IDS = [
  "b8eb3971-2e56-4f44-a643-2312ed2ae79b", // 納品書1.pdf
  "3206a804-55dc-49a7-bc58-6cfa8e406e1f", // 納品書2.pdf
];

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function fail(message: string): never {
  console.error(message);
  process.exit(1);
}

function parseArgs(argv: string[]) {
  const groups: string[] = [];
  let execute = false;
  let json = false;
  let expectCreated: number | null = null;

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--execute") execute = true;
    else if (arg === "--json") json = true;
    else if (arg === "--group") {
      const value = argv[(i += 1)];
      if (!value || !uuidPattern.test(value))
        fail("--group には取込グループIDを指定してください。");
      groups.push(value);
    } else if (arg === "--expect-created") {
      const value = Number(argv[(i += 1)]);
      if (!Number.isInteger(value) || value < 0) {
        fail("--expect-created には 0 以上の整数を指定してください。");
      }
      expectCreated = value;
    } else {
      fail(`不明な引数です: ${arg}`);
    }
  }

  if (execute && expectCreated === null) {
    fail(
      "--execute には --expect-created <件数> が必要です。先にドライランを実行し、表示された「作成する仮登録商品」の件数を指定してください。",
    );
  }
  return {
    uploadGroupIds: groups.length ? groups : DEFAULT_UPLOAD_GROUP_IDS,
    execute,
    json,
    expectCreated,
  };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));

  const url = process.env.DATABASE_URL_UNPOOLED;
  if (!url) fail("DATABASE_URL_UNPOOLED が設定されていません。");

  // 接続先の取り違えを防ぐため、ホスト名とDB名だけを表示する（認証情報は表示しない）。
  try {
    const parsed = new URL(url);
    console.error(`接続先: ${parsed.hostname}${parsed.pathname}`);
  } catch {
    fail("DATABASE_URL_UNPOOLED の形式が正しくありません。");
  }
  console.error(args.execute ? "モード: 実行（コミットします）" : "モード: ドライラン");

  const client = postgres(url, { max: 1, prepare: false });
  try {
    const db = drizzle(client, { schema });
    const report = await migrateProvisionalProducts(db, {
      uploadGroupIds: args.uploadGroupIds,
      dryRun: !args.execute,
      expectCreated: args.expectCreated,
    });
    console.log(args.json ? JSON.stringify(report, null, 2) : formatMigrationReport(report));
    if (args.execute && !report.committed) process.exitCode = 2;
  } finally {
    await client.end({ timeout: 5 });
  }
}

main().catch((error) => {
  console.error("移行に失敗しました（変更は取り消されています）。");
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
