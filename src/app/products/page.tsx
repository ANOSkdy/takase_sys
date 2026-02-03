import { headers } from "next/headers";
import type { CSSProperties, ReactNode } from "react";
import type { ProductListItem } from "@/services/products/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type ProductsResponse = { items: ProductListItem[] };

async function getBaseUrl() {
  const headerList = await headers();
  const host = headerList.get("host");
  const proto = headerList.get("x-forwarded-proto") ?? "http";
  return host ? `${proto}://${host}` : "";
}

type SearchParams = { keyword?: string };

export default async function ProductsPage({
  searchParams,
}: {
  searchParams?: Promise<SearchParams>;
}) {
  const resolvedSearchParams = await (searchParams ?? Promise.resolve({} as SearchParams));
  const keyword = resolvedSearchParams.keyword ?? "";
  const baseUrl = await getBaseUrl();
  const query = keyword ? `?keyword=${encodeURIComponent(keyword)}` : "";
  const res = await fetch(`${baseUrl}/api/products${query}`, { cache: "no-store" });
  const items = res.ok ? ((await res.json()) as ProductsResponse).items : [];

  return (
    <main style={{ padding: "var(--space-6)", display: "grid", gap: "var(--space-4)" }}>
      <header style={{ display: "grid", gap: "var(--space-2)" }}>
        <h1 style={{ margin: 0 }}>商品マスタ</h1>
        <p style={{ margin: 0, color: "var(--muted)" }}>PDF解析で自動生成された商品一覧です。</p>
      </header>

      <section style={cardStyle}>
        <form method="get" style={{ display: "flex", gap: 8, marginBottom: 16 }}>
          <input
            type="search"
            name="keyword"
            placeholder="商品名・商品キーで検索"
            defaultValue={keyword}
            style={inputStyle}
          />
          <button type="submit" style={buttonStyle}>
            検索
          </button>
        </form>
        <div style={{ overflowX: "auto" }}>
          <table style={tableStyle}>
            <thead>
              <tr>
                <Th>商品キー</Th>
                <Th>商品名</Th>
                <Th>規格</Th>
                <Th>品質</Th>
                <Th>更新日</Th>
              </tr>
            </thead>
            <tbody>
              {items.map((item) => (
                <tr key={item.productId}>
                  <Td muted>{item.productKey}</Td>
                  <Td>
                    <a href={`/products/${item.productId}`} style={linkStyle}>
                      {item.productName}
                    </a>
                  </Td>
                  <Td muted>{item.spec ?? "-"}</Td>
                  <Td muted>{item.qualityFlag}</Td>
                  <Td muted>{item.lastUpdatedAt.slice(0, 10)}</Td>
                </tr>
              ))}
              {items.length === 0 && (
                <tr>
                  <td colSpan={5} style={{ padding: 24, textAlign: "center", color: "var(--muted)" }}>
                    まだ商品がありません。
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>
    </main>
  );
}

const cardStyle: CSSProperties = {
  background: "var(--surface)",
  border: "1px solid var(--border)",
  borderRadius: "var(--radius-lg)",
  boxShadow: "var(--shadow-soft)",
  padding: "var(--space-4)",
};

const tableStyle: CSSProperties = {
  width: "100%",
  borderCollapse: "separate",
  borderSpacing: 0,
  background: "var(--surface)",
  border: "1px solid var(--border)",
  borderRadius: "var(--radius-lg)",
  overflow: "hidden",
};

const linkStyle: CSSProperties = {
  color: "var(--text)",
  textDecoration: "underline",
};

const inputStyle: CSSProperties = {
  padding: "10px 12px",
  borderRadius: "var(--radius-md)",
  border: "1px solid var(--border)",
  minWidth: 240,
};

const buttonStyle: CSSProperties = {
  padding: "10px 16px",
  borderRadius: "var(--radius-md)",
  border: "1px solid var(--border)",
  background: "var(--surface)",
  cursor: "pointer",
};

function Th({ children }: { children: ReactNode }) {
  return (
    <th
      style={{
        textAlign: "left",
        padding: "12px 14px",
        background: "rgba(0,0,0,0.03)",
        borderBottom: "1px solid var(--border)",
        fontSize: 12,
        textTransform: "uppercase",
        letterSpacing: "0.04em",
        color: "var(--muted)",
      }}
    >
      {children}
    </th>
  );
}

function Td({ children, muted }: { children: ReactNode; muted?: boolean }) {
  return (
    <td
      style={{
        padding: "12px 14px",
        borderBottom: "1px solid var(--border)",
        color: muted ? "var(--muted)" : "inherit",
      }}
    >
      {children}
    </td>
  );
}
