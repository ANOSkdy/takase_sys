import ProductsClient from "./products-client";
import { productSearchSchema, searchProducts } from "@/services/products/search";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type SearchParams = Record<string, string | string[] | undefined>;

export default async function ProductsPage({
  searchParams,
}: {
  searchParams?: Promise<SearchParams>;
}) {
  const sp = await (searchParams ?? Promise.resolve({} as SearchParams));

  const normalized: Record<string, string | undefined> = {};
  for (const [k, v] of Object.entries(sp)) {
    normalized[k] = Array.isArray(v) ? v[0] : v;
  }

  const parsed = productSearchSchema.safeParse(normalized);
  const params = parsed.success ? parsed.data : productSearchSchema.parse({});
  const result = await searchProducts(params);

  return (
    <main style={{ padding: "var(--space-6)" }}>
      <header style={{ marginBottom: "var(--space-4)" }}>
        <h1 style={{ margin: 0 }}>商品マスタ</h1>
      </header>
      <ProductsClient result={result} />
    </main>
  );
}
