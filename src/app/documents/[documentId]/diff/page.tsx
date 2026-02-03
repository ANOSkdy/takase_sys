import { headers } from "next/headers";
import type { CSSProperties, ReactNode } from "react";
import type { DocumentDiffItem, DocumentLineItem } from "@/services/documents/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type DiffResponse = { items: DocumentDiffItem[] };
type LineItemResponse = { items: DocumentLineItem[] };

async function getBaseUrl() {
  const headerList = await headers();
  const host = headerList.get("host");
  const proto = headerList.get("x-forwarded-proto") ?? "http";
  return host ? `${proto}://${host}` : "";
}

function formatDate(iso: string | null) {
  if (!iso) return "-";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return date.toISOString().slice(0, 10);
}

export default async function DocumentDiffPage({
  params,
}: {
  params: Promise<{ documentId: string }>;
}) {
  const { documentId } = await params;
  const baseUrl = await getBaseUrl();

  const [lineRes, diffRes] = await Promise.all([
    fetch(`${baseUrl}/api/documents/${documentId}/line-items`, { cache: "no-store" }),
    fetch(`${baseUrl}/api/documents/${documentId}/diff`, { cache: "no-store" }),
  ]);

  const lineItems = lineRes.ok ? ((await lineRes.json()) as LineItemResponse).items : [];
  const diffItems = diffRes.ok ? ((await diffRes.json()) as DiffResponse).items : [];

  const summary = diffItems.reduce<Record<string, number>>((acc, item) => {
    acc[item.classification] = (acc[item.classification] ?? 0) + 1;
    return acc;
  }, {});

  return (
    <main style={{ padding: "var(--space-6)", display: "grid", gap: "var(--space-4)" }}>
      <header style={{ display: "grid", gap: "var(--space-2)" }}>
        <h1 style={{ margin: 0 }}>差分結果</h1>
        <p style={{ margin: 0, color: "var(--muted)" }}>
          PDF解析の差分と自動更新の判定結果です。
        </p>
      </header>

      <section style={cardStyle}>
        <h2 style={{ marginTop: 0 }}>更新サマリー</h2>
        <ul style={{ display: "grid", gap: 4, margin: 0, paddingLeft: 16 }}>
          {Object.entries(summary).map(([key, count]) => (
            <li key={key}>
              {key}: {count} 件
            </li>
          ))}
          {Object.keys(summary).length === 0 && (
            <li style={{ color: "var(--muted)" }}>差分はまだありません。</li>
          )}
        </ul>
      </section>

      <section style={cardStyle}>
        <h2 style={{ marginTop: 0 }}>明細</h2>
        <div style={{ overflowX: "auto" }}>
          <table style={tableStyle}>
            <thead>
              <tr>
                <Th>行</Th>
                <Th>商品名</Th>
                <Th>規格</Th>
                <Th>数量</Th>
                <Th>単価</Th>
                <Th>金額</Th>
                <Th>信頼度</Th>
              </tr>
            </thead>
            <tbody>
              {lineItems.map((item) => (
                <tr key={item.lineItemId}>
                  <Td>{item.lineNo}</Td>
                  <Td>{item.productNameRaw ?? "-"}</Td>
                  <Td muted>{item.specRaw ?? "-"}</Td>
                  <Td muted>{item.quantity ?? "-"}</Td>
                  <Td muted>{item.unitPrice ?? "-"}</Td>
                  <Td muted>{item.amount ?? "-"}</Td>
                  <Td muted>{item.systemConfidence ?? "-"}</Td>
                </tr>
              ))}
              {lineItems.length === 0 && (
                <tr>
                  <td colSpan={7} style={{ padding: 24, textAlign: "center", color: "var(--muted)" }}>
                    まだ解析結果がありません。
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>

      <section style={cardStyle}>
        <h2 style={{ marginTop: 0 }}>差分</h2>
        <div style={{ overflowX: "auto" }}>
          <table style={tableStyle}>
            <thead>
              <tr>
                <Th>判定</Th>
                <Th>理由</Th>
                <Th>仕入先</Th>
                <Th>請求日</Th>
                <Th>Before</Th>
                <Th>After</Th>
              </tr>
            </thead>
            <tbody>
              {diffItems.map((item) => (
                <tr key={item.diffItemId}>
                  <Td>{item.classification}</Td>
                  <Td muted>{item.reason ?? "-"}</Td>
                  <Td>{item.vendorName ?? "-"}</Td>
                  <Td muted>{formatDate(item.invoiceDate)}</Td>
                  <Td muted>
                    <pre style={preStyle}>{JSON.stringify(item.before, null, 2)}</pre>
                  </Td>
                  <Td muted>
                    <pre style={preStyle}>{JSON.stringify(item.after, null, 2)}</pre>
                  </Td>
                </tr>
              ))}
              {diffItems.length === 0 && (
                <tr>
                  <td colSpan={6} style={{ padding: 24, textAlign: "center", color: "var(--muted)" }}>
                    差分はまだありません。
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

const preStyle: CSSProperties = {
  margin: 0,
  fontSize: 12,
  whiteSpace: "pre-wrap",
  wordBreak: "break-word",
};
