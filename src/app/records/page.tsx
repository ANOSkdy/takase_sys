import RecordsSearchClient from "./records-client";
import { recordSearchSchema, searchRecords } from "@/services/records/search";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type SearchParams = Record<string, string | string[] | undefined>;

export default async function RecordsPage({
  searchParams,
}: {
  // Next.js 16 の PageProps 互換：searchParams は Promise 扱い
  searchParams?: Promise<SearchParams>;
}) {
  const sp = await (searchParams ?? Promise.resolve({} as SearchParams));

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
        <h1 style={{ margin: 0 }}>仕切り表</h1>
      </header>

      <RecordsSearchClient result={result} />
    </main>
  );
}
