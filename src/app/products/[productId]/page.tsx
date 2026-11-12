import { headers } from "next/headers";
import type { CSSProperties, ReactNode } from "react";
import {
  attentionTextStyle,
  ReviewStatusBadge,
  SourceLink,
} from "@/components/product/ReviewStatus";
import { needsAttention } from "@/domain/review-status";
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
        <p>商品が見つかりませんでした。</p>
      </main>
    );
  }

  // 要確認の理由は、注意理由が記録された最新の出典から表示する。
  const attentionReason =
    product.reviewStatus === "NEEDS_REVIEW"
      ? (product.sources.find((source) => source.attentionReason)?.attentionReason ?? null)
      : null;

  return (
    <main style={{ padding: "var(--space-6)", display: "grid", gap: "var(--space-4)" }}>
      <header style={{ display: "grid", gap: "var(--space-2)" }}>
        <h1 style={{ margin: 0, ...attentionTextStyle(product.reviewStatus) }}>
          {product.productName}
        </h1>
        <div>
          <ReviewStatusBadge status={product.reviewStatus} reason={attentionReason} />
        </div>
        <p style={{ margin: 0, color: "var(--muted)" }}>商品ID: {product.productId}</p>
      </header>

      {product.reviewStatus === "MERGED" && (
        <section style={noticeStyle} role="note">
          この商品は統合済みです。
          {product.mergedInto ? (
            <>
              統合先:{" "}
              <a href={`/products/${product.mergedInto.productId}`}>
                {product.mergedInto.productName}
              </a>
            </>
          ) : (
            "統合先を特定できませんでした。"
          )}
        </section>
      )}

      {needsAttention(product.reviewStatus) && (
        <section style={noticeStyle} role="note">
          {product.reviewStatus === "PROVISIONAL"
            ? "PDFから作成された未確認の商品です。商品情報と価格は、出典PDFで内容を確認してから利用してください。"
            : "確認が必要な商品です。出典PDFで内容を確認してください。"}
        </section>
      )}

      <section style={cardStyle}>
        <h2 style={{ marginTop: 0 }}>基本情報</h2>
        <dl style={{ display: "grid", gridTemplateColumns: "140px 1fr", gap: 8, margin: 0 }}>
          <dt style={termStyle}>商品キー</dt>
          <dd style={valueStyle}>{product.productKey}</dd>
          <dt style={termStyle}>規格</dt>
          <dd style={valueStyle}>{product.spec ?? "-"}</dd>
          <dt style={termStyle}>確認状態</dt>
          <dd style={valueStyle}>
            <ReviewStatusBadge status={product.reviewStatus} />
            {product.reviewStatus === "VERIFIED" && product.reviewedAt && (
              <span style={{ marginLeft: 8, color: "var(--muted)" }}>
                {product.reviewedAt.slice(0, 10)}
                {product.reviewedBy ? ` ／ 確認者（入力値）: ${product.reviewedBy}` : ""}
              </span>
            )}
          </dd>
          <dt style={termStyle}>品質フラグ</dt>
          <dd style={valueStyle}>{product.qualityFlag}</dd>
          <dt style={termStyle}>カテゴリ</dt>
          <dd style={valueStyle}>{product.category ?? "-"}</dd>
          <dt style={termStyle}>既定単価</dt>
          <dd style={valueStyle}>{product.defaultUnitPrice ?? "-"}</dd>
          <dt style={termStyle}>更新日</dt>
          <dd style={valueStyle}>{product.lastUpdatedAt.slice(0, 10)}</dd>
        </dl>
      </section>

      <section style={cardStyle}>
        <h2 style={{ marginTop: 0 }}>出典PDF（{product.sources.length}件）</h2>
        {product.sources.length === 0 ? (
          <p style={{ margin: 0, color: "var(--muted)" }}>
            この商品に紐付く出典PDFは記録されていません。
          </p>
        ) : (
          <ul style={{ margin: 0, paddingLeft: 20, display: "grid", gap: 6 }}>
            {product.sources.map((source) => (
              <li key={source.lineItemId}>
                <SourceLink source={source} />
                <span style={{ marginLeft: 8, fontSize: 12, color: "var(--muted)" }}>
                  {source.lineNo != null ? `明細${source.lineNo}行目` : ""}
                  {source.attentionReason ? ` ／ 注意: ${source.attentionReason}` : ""}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section style={cardStyle}>
        <h2 style={{ marginTop: 0 }}>仕入先価格</h2>
        {needsAttention(product.reviewStatus) && product.vendorPrices.length > 0 && (
          <p style={{ marginTop: 0, color: "var(--color-danger)" }}>
            ⚠ 商品が未確認のため、以下の価格も未確認です。
          </p>
        )}
        <div style={{ overflowX: "auto" }}>
          <table style={tableStyle}>
            <thead>
              <tr>
                <Th>仕入先</Th>
                <Th>単価</Th>
                <Th>価格更新日</Th>
                <Th>更新日時</Th>
              </tr>
            </thead>
            <tbody>
              {product.vendorPrices.map((row) => (
                <tr key={row.vendorPriceId}>
                  <Td>{row.vendorName}</Td>
                  <Td muted>{row.unitPrice}</Td>
                  <Td muted>{row.priceUpdatedOn ?? "-"}</Td>
                  <Td muted>{row.updatedAt.slice(0, 10)}</Td>
                </tr>
              ))}
              {product.vendorPrices.length === 0 && (
                <tr>
                  <td
                    colSpan={4}
                    style={{ padding: 24, textAlign: "center", color: "var(--muted)" }}
                  >
                    まだ価格情報がありません。
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
                <Th>フィールド</Th>
                <Th>仕入先</Th>
                <Th>Before</Th>
                <Th>After</Th>
                <Th>更新日</Th>
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
                </tr>
              ))}
              {product.updateHistory.length === 0 && (
                <tr>
                  <td
                    colSpan={5}
                    style={{ padding: 24, textAlign: "center", color: "var(--muted)" }}
                  >
                    まだ更新履歴がありません。
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

const noticeStyle: CSSProperties = {
  background: "var(--color-danger-soft)",
  border: "1px solid var(--color-danger)",
  borderRadius: "var(--radius-lg)",
  padding: "var(--space-3) var(--space-4)",
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

const termStyle: CSSProperties = {
  color: "var(--muted)",
};

const valueStyle: CSSProperties = {
  margin: 0,
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
