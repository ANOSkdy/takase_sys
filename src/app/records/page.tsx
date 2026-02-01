import { recordSearchSchema, searchRecords } from "@/services/records/search";
import RecordsSearchClient from "./records-client";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type SearchParams = Record<string, string | string[] | undefined>;

export default async function RecordsPage({
  searchParams,
}: {
  searchParams?: SearchParams | Promise<SearchParams>;
}) {
  // Next.js 16 では searchParams が Promise の場合があるため unwrap する
  const sp = await Promise.resolve(searchParams ?? {});

  const normalized: Record<string, string | undefined> = {};
  for (const [k, v] of Object.entries(sp)) {
    normalized[k] = Array.isArray(v) ? v[0] : v;
  }

  const parsed = recordSearchSchema.safeParse(normalized);
  const params = parsed.success ? parsed.data : recordSearchSchema.parse({});

  const result = await searchRecords(params);

  return (
    <main style={{ padding: "var(--space-6)" }}>
      <header style={{ marginBottom: "var(--space-4)" }}>
        <h1 style={{ margin: 0 }}>レコード検索</h1>
        <p style={{ color: "var(--muted)", marginTop: "var(--space-2)" }}>
          品名/規格/価格/ベンダー/最終更新日/カテゴリで絞り込み、フリーワードであいまい検索できます。
        </p>
      </header>

      <RecordsSearchClient result={result} />
    </main>
  );
}
