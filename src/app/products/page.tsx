import { headers } from "next/headers";
import type { CSSProperties, ReactNode } from "react";
import type { ProductListItem } from "@/services/products/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type ProductListResponse = {
  items: ProductListItem[];
  total: number;
  page: number;
  pageSize: number;
};

async function getBaseUrl() {
  const headerList = await headers();
  const host = headerList.get("host");
  const proto = headerList.get("x-forwarded-proto") ?? "http";
  return host ? `${proto}://${host}` : "";
}

export default async function ProductsPage({
  searchParams,
}: {
  searchParams: Promise<{ keyword?: string }>;
}) {
  const { keyword } = await searchParams;
  const baseUrl = await getBaseUrl();
  const params = new URLSearchParams();
  if (keyword) params.set("keyword", keyword);
  const res = await fetch(`${baseUrl}/api/products?${params.toString()}`, { cache: "no-store" });
  const data = res.ok
    ? ((await res.json()) as ProductListResponse)
    : { items: [], total: 0, page: 1, pageSize: 50 };

  return (
    <main style={{ padding: "var(--space-6)", display: "grid", gap: "var(--space-4)" }}>
      <header style={{ display: "grid", gap: "var(--space-2)" }}>
        <h1 style={{ margin: 0 }}>商品マスター</h1>
        <p style={{ margin: 0, color: "var(--muted)" }}>
          PDF 解析で登録された商品と更新履歴の一覧です。
        </p>
      </header>

      <section style={cardStyle}>
        <form method="GET" style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <input
            name="keyword"
            defaultValue={keyword ?? ""}
            placeholder="キーワード検索"
            style={inputStyle}
          />
          <button type="submit" style={buttonStyle}>
            検索
          </button>
        </form>
      </section>

      <section style={cardStyle}>
        <div style={{ marginBottom: 8, color: "var(--muted)" }}>
          {data.total} 件
        </div>
        <div style={{ overflowX: "auto" }}>
          <table style={tableStyle}>
            <thead>
              <tr>
                <Th>キー</Th>
                <Th>商品名</Th>
                <Th>規格</Th>
                <Th>更新日</Th>
                <Th>品質</Th>
              </tr>
            </thead>
            <tbody>
              {data.items.map((item) => (
                <tr key={item.productId}>
                  <Td>
                    <a href={`/products/${item.productId}`} style={linkStyle}>
                      {item.productKey}
                    </a>
                  </Td>
                  <Td>{item.productName}</Td>
                  <Td muted>{item.spec ?? "-"}</Td>
                  <Td muted>{item.lastUpdatedAt.slice(0, 10)}</Td>
                  <Td muted>{item.qualityFlag}</Td>
                </tr>
              ))}
              {data.items.length === 0 && (
                <tr>
                  <td colSpan={5} style={{ padding: 24, textAlign: "center", color: "var(--muted)" }}>
                    商品がありません。
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

const inputStyle: CSSProperties = {
  padding: "10px 12px",
  borderRadius: 8,
  border: "1px solid var(--border)",
  minWidth: 240,
};

const buttonStyle: CSSProperties = {
  padding: "10px 16px",
  borderRadius: 8,
  border: "1px solid var(--border)",
  background: "var(--surface)",
  cursor: "pointer",
};

const linkStyle: CSSProperties = {
  color: "inherit",
  textDecoration: "none",
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
        verticalAlign: "top",
      }}
    >
      {children}
    </td>
  );
}
