import { notFound } from "next/navigation";
import { and, eq } from "drizzle-orm";
import { getDb } from "@/db/client";
import { documentDiffItems, documentParseRuns } from "@/db/schema";
import { listProducts } from "@/services/products/repository";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type SearchParams = { keyword?: string };

function asObject(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function asText(value: unknown): string {
  return typeof value === "string" && value.trim() ? value.trim() : "-";
}

function searchText(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

export default async function LinkPage({
  params,
  searchParams,
}: {
  params: Promise<{ documentId: string; diffItemId: string }>;
  searchParams?: Promise<SearchParams>;
}) {
  const { documentId, diffItemId } = await params;
  const sp = await (searchParams ?? Promise.resolve({} as SearchParams));
  const db = getDb();

  const [row] = await db
    .select({
      diffItemId: documentDiffItems.diffItemId,
      vendorName: documentDiffItems.vendorName,
      after: documentDiffItems.after,
    })
    .from(documentDiffItems)
    .innerJoin(
      documentParseRuns,
      eq(documentParseRuns.parseRunId, documentDiffItems.parseRunId),
    )
    .where(
      and(
        eq(documentDiffItems.diffItemId, diffItemId),
        eq(documentParseRuns.documentId, documentId),
      ),
    )
    .limit(1);

  if (!row) notFound();

  const after = asObject(row.after);
  const productNameKeyword = searchText(after.productName);
  const keyword = sp.keyword ?? productNameKeyword;
  const products = await listProducts({ keyword: keyword || null, limit: 50 });

  return (
    <main style={{ padding: 24, display: "grid", gap: 16 }}>
      <a href={`/documents/${documentId}/diff`}>← 差分へ戻る</a>
      <h1>既存商品に紐づける</h1>

      <section style={cardStyle}>
        <h2>PDF明細</h2>
        <p>商品名: {asText(after.productName)}</p>
        <p>メーカー: {asText(after.productMaker)}</p>
        <p>規格: {asText(after.spec)}</p>
        <p>単価: {asText(after.unitPrice)}</p>
        <p>仕入先: {row.vendorName ?? "-"}</p>
      </section>

      <section style={cardStyle}>
        <p style={{ marginTop: 0, color: "var(--muted)" }}>
          初期候補はPDF明細の商品名だけで検索しています。規格やメーカーで絞り込みたい場合は検索語を編集してください。
        </p>
        <form
          method="get"
          style={{ display: "flex", gap: 8, marginBottom: 16 }}
        >
          <input name="keyword" defaultValue={keyword} style={inputStyle} />
          <button type="submit">検索</button>
        </form>

        <table style={{ width: "100%", borderCollapse: "collapse" }}>
          <thead>
            <tr>
              <th style={thStyle}>商品名</th>
              <th style={thStyle}>規格</th>
              <th style={thStyle}>カテゴリ</th>
              <th style={thStyle}>商品キー</th>
              <th style={thStyle}>操作</th>
            </tr>
          </thead>
          <tbody>
            {products.map((product) => (
              <tr key={product.productId}>
                <td style={tdStyle}>{product.productName}</td>
                <td style={tdStyle}>{product.spec ?? "-"}</td>
                <td style={tdStyle}>{product.category ?? "-"}</td>
                <td style={tdStyle}>{product.productKey}</td>
                <td style={tdStyle}>
                  <form
                    method="post"
                    action={`/api/documents/${documentId}/diff/${diffItemId}/link-product`}
                  >
                    <input
                      type="hidden"
                      name="productId"
                      value={product.productId}
                    />
                    <button type="submit">紐づける</button>
                  </form>
                </td>
              </tr>
            ))}
            {products.length === 0 && (
              <tr>
                <td colSpan={5} style={tdStyle}>
                  候補商品がありません。検索語を短くするか、別の商品名で検索してください。
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </section>
    </main>
  );
}

const cardStyle = {
  background: "var(--surface)",
  border: "1px solid var(--border)",
  borderRadius: "var(--radius-lg)",
  padding: 16,
};

const inputStyle = {
  minWidth: 280,
  padding: "8px 10px",
};

const thStyle = {
  textAlign: "left" as const,
  padding: 10,
  borderBottom: "1px solid var(--border)",
};

const tdStyle = {
  padding: 10,
  borderBottom: "1px solid var(--border)",
};
