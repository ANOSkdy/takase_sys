import { headers } from "next/headers";
import type { CSSProperties, ReactNode } from "react";
import type { ProductDetail } from "@/services/products/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function getBaseUrl() {
  const headerList = await headers();
  const host = headerList.get("host");
  const proto = headerList.get("x-forwarded-proto") ?? "http";
  return host ? `${proto}://${host}` : "";
}

export default async function ProductDetailPage({
  params,
}: {
  params: Promise<{ productId: string }>;
}) {
  const { productId } = await params;
  const baseUrl = await getBaseUrl();
  const res = await fetch(`${baseUrl}/api/products/${productId}`, { cache: "no-store" });
  const product = res.ok ? ((await res.json()) as ProductDetail) : null;

  if (!product) {
    return (
      <main style={{ padding: "var(--space-6)" }}>
        <p style={{ color: "var(--muted)" }}>商品が見つかりませんでした。</p>
      </main>
    );
  }

  return (
    <main style={{ padding: "var(--space-6)", display: "grid", gap: "var(--space-4)" }}>
      <header style={{ display: "grid", gap: "var(--space-2)" }}>
        <h1 style={{ margin: 0 }}>{product.productName}</h1>
        <p style={{ margin: 0, color: "var(--muted)" }}>{product.productKey}</p>
      </header>

      <section style={cardStyle}>
        <h2 style={{ marginTop: 0 }}>基本情報</h2>
        <dl style={dlStyle}>
          <div>
            <dt>規格</dt>
            <dd>{product.spec ?? "-"}</dd>
          </div>
          <div>
            <dt>カテゴリ</dt>
            <dd>{product.category ?? "-"}</dd>
          </div>
          <div>
            <dt>標準単価</dt>
            <dd>{product.defaultUnitPrice ?? "-"}</dd>
          </div>
          <div>
            <dt>品質フラグ</dt>
            <dd>{product.qualityFlag}</dd>
          </div>
        </dl>
      </section>

      <section style={cardStyle}>
        <h2 style={{ marginTop: 0 }}>仕入先単価</h2>
        <div style={{ overflowX: "auto" }}>
          <table style={tableStyle}>
            <thead>
              <tr>
                <Th>仕入先</Th>
                <Th>単価</Th>
                <Th>請求日</Th>
                <Th>更新日</Th>
              </tr>
            </thead>
            <tbody>
              {product.vendorPrices.map((row) => (
                <tr key={row.vendorPriceId}>
                  <Td>{row.vendorName}</Td>
                  <Td>{row.unitPrice}</Td>
                  <Td muted>{row.priceUpdatedOn ?? "-"}</Td>
                  <Td muted>{row.updatedAt.slice(0, 10)}</Td>
                </tr>
              ))}
              {product.vendorPrices.length === 0 && (
                <tr>
                  <td colSpan={4} style={{ padding: 24, textAlign: "center", color: "var(--muted)" }}>
                    まだ単価情報がありません。
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>

      <section style={cardStyle}>
        <h2 style={{ marginTop: 0 }}>更新履歴</h2>
        <div style={{ overflowX: "auto" }}>
          <table style={tableStyle}>
            <thead>
              <tr>
                <Th>項目</Th>
                <Th>仕入先</Th>
                <Th>Before</Th>
                <Th>After</Th>
                <Th>更新日</Th>
                <Th>更新者</Th>
              </tr>
            </thead>
            <tbody>
              {product.updateHistory.map((row) => (
                <tr key={row.historyId}>
                  <Td>{row.fieldName}</Td>
                  <Td muted>{row.vendorName ?? "-"}</Td>
                  <Td muted>{row.beforeValue ?? "-"}</Td>
                  <Td muted>{row.afterValue ?? "-"}</Td>
                  <Td muted>{row.updatedAt.slice(0, 10)}</Td>
                  <Td muted>{row.updatedBy ?? "-"}</Td>
                </tr>
              ))}
              {product.updateHistory.length === 0 && (
                <tr>
                  <td colSpan={6} style={{ padding: 24, textAlign: "center", color: "var(--muted)" }}>
                    更新履歴がありません。
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

const dlStyle: CSSProperties = {
  display: "grid",
  gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))",
  gap: "12px 24px",
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
