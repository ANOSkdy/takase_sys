import Link from "next/link";
import type { CSSProperties, ReactNode } from "react";
import { getProductDetail } from "@/services/products/detail";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function formatDate(iso: string | null) {
  if (!iso) return "-";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "-";
  return new Intl.DateTimeFormat("ja-JP", {
    timeZone: "Asia/Tokyo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
}

export default async function ProductDetailPage({
  params,
}: {
  params: Promise<{ productId: string }>;
}) {
  const { productId } = await params;
  const detail = await getProductDetail(productId);

  if (!detail) {
    return (
      <main style={{ padding: "var(--space-6)" }}>
        <h1>商品詳細</h1>
        <p>商品が見つかりません。</p>
        <Link href="/products">商品一覧へ戻る</Link>
      </main>
    );
  }

  return (
    <main style={{ padding: "var(--space-6)", display: "grid", gap: "var(--space-4)" }}>
      <header style={{ display: "grid", gap: "var(--space-2)" }}>
        <Link href="/products">← 商品一覧</Link>
        <h1 style={{ margin: 0 }}>{detail.productName}</h1>
        <p style={{ margin: 0, color: "var(--muted)" }}>{detail.productKey}</p>
      </header>

      <section style={cardStyle}>
        <h2 style={{ marginTop: 0 }}>基本情報</h2>
        <div style={{ display: "grid", gap: "var(--space-2)" }}>
          <div>規格: {detail.spec ?? "-"}</div>
          <div>カテゴリ: {detail.category ?? "-"}</div>
          <div>品質フラグ: {detail.qualityFlag}</div>
          <div>最終更新日: {formatDate(detail.lastUpdatedAt)}</div>
          <div>更新ソース: {detail.lastSourceType ?? "-"}</div>
        </div>
      </section>

      <section style={cardStyle}>
        <h2 style={{ marginTop: 0 }}>ベンダー単価</h2>
        <table style={tableStyle}>
          <thead>
            <tr>
              <Th>ベンダー</Th>
              <Th>単価</Th>
              <Th>更新日</Th>
              <Th>ソース</Th>
            </tr>
          </thead>
          <tbody>
            {detail.vendorPrices.map((row) => (
              <tr key={row.vendorPriceId}>
                <Td>{row.vendorName}</Td>
                <Td>{row.unitPrice}</Td>
                <Td>{formatDate(row.priceUpdatedOn ?? row.updatedAt)}</Td>
                <Td muted>{row.sourceType}</Td>
              </tr>
            ))}
            {detail.vendorPrices.length === 0 && (
              <tr>
                <td colSpan={4} style={{ padding: 24, textAlign: "center", color: "var(--muted)" }}>
                  登録済みの単価がありません。
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </section>

      <section style={cardStyle}>
        <h2 style={{ marginTop: 0 }}>更新履歴（直近50件）</h2>
        <table style={tableStyle}>
          <thead>
            <tr>
              <Th>日時</Th>
              <Th>項目</Th>
              <Th>ベンダー</Th>
              <Th>変更内容</Th>
            </tr>
          </thead>
          <tbody>
            {detail.updateHistory.map((row) => (
              <tr key={row.historyId}>
                <Td>{formatDate(row.updatedAt)}</Td>
                <Td>{row.fieldName}</Td>
                <Td>{row.vendorName ?? "-"}</Td>
                <Td muted>
                  {row.beforeValue ?? "-"} → {row.afterValue ?? "-"}
                </Td>
              </tr>
            ))}
            {detail.updateHistory.length === 0 && (
              <tr>
                <td colSpan={4} style={{ padding: 24, textAlign: "center", color: "var(--muted)" }}>
                  更新履歴がありません。
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
  border: "1px solid var(--border)",
  borderRadius: 12,
  padding: "var(--space-4)",
  background: "var(--surface)",
};

const tableStyle: CSSProperties = {
  width: "100%",
  borderCollapse: "collapse",
  fontSize: 14,
};

function Th({ children }: { children: ReactNode }) {
  return (
    <th
      style={{
        textAlign: "left",
        padding: "10px 12px",
        borderBottom: "1px solid var(--border)",
        whiteSpace: "nowrap",
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
        padding: "10px 12px",
        borderBottom: "1px solid var(--border)",
        color: muted ? "var(--muted)" : "inherit",
        whiteSpace: "nowrap",
      }}
    >
      {children}
    </td>
  );
}
