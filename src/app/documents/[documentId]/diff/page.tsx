import type { CSSProperties, ReactNode } from "react";
import {
  getDocumentDetail,
  listDocumentDiffItems,
  listDocumentLineItems,
} from "@/services/documents/repository";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function formatDate(iso: string | null) {
  if (!iso) return "-";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return date.toISOString().slice(0, 10);
}

function getClassificationLabel(classification: string) {
  switch (classification) {
    case "UPDATE":
      return "更新候補";
    case "BLOCKED":
      return "自動停止";
    case "UNMATCHED":
      return "未突合";
    case "NO_CHANGE":
      return "変更なし";
    case "NEW_CANDIDATE":
      return "新規候補（確認待ち）";
    default:
      return classification;
  }
}

function getReasonLabel(reason: string | null) {
  switch (reason) {
    case "REVIEW_REQUIRED_BEFORE_PRODUCT_CREATE":
      return "既存商品への紐づけ、またはカテゴリ選択付き新規登録が必要です。";
    case "NO_PRODUCT_MATCH":
      return "既存商品に一致しませんでした。";
    case "LINKED_TO_EXISTING_PRODUCT":
      return "既存商品に紐づけ済みです。";
    default:
      return reason ?? "-";
  }
}

function canLinkProduct(classification: string) {
  return classification === "NEW_CANDIDATE" || classification === "UNMATCHED";
}

type SearchParams = { classification?: string };

export default async function DocumentDiffPage({
  params,
  searchParams,
}: {
  params: Promise<{ documentId: string }>;
  searchParams?: Promise<SearchParams>;
}) {
  const { documentId } = await params;
  const resolvedSearchParams = await (searchParams ?? Promise.resolve({} as SearchParams));
  const classificationFilter = resolvedSearchParams.classification ?? "ALL";

  const doc = await getDocumentDetail(documentId);
  const parseRunId = doc?.latestParseRun?.parseRunId ?? null;
  const [lineItems, diffItems] = await Promise.all([
    listDocumentLineItems(documentId, parseRunId),
    listDocumentDiffItems(documentId, { parseRunId }),
  ]);

  const summary = diffItems.reduce<Record<string, number>>((acc, item) => {
    acc[item.classification] = (acc[item.classification] ?? 0) + 1;
    return acc;
  }, {});

  const tabs = ["ALL", "UPDATE", "BLOCKED", "UNMATCHED", "NO_CHANGE", "NEW_CANDIDATE"];
  const filteredDiffItems =
    classificationFilter === "ALL"
      ? diffItems
      : diffItems.filter((item) => item.classification === classificationFilter);

  return (
    <main style={{ padding: "var(--space-6)", display: "grid", gap: "var(--space-4)" }}>
      <header style={{ display: "grid", gap: "var(--space-2)" }}>
        <a href="/documents" style={backLinkStyle}>
          ← 一覧へ戻る
        </a>
        <h1 style={{ margin: 0 }}>差分結果</h1>
        <p style={{ margin: 0, color: "var(--muted)" }}>PDF解析の差分と自動更新の判定結果です。</p>
        {parseRunId && (
          <p style={{ margin: 0, color: "var(--muted)", fontSize: 12 }}>parseRunId: {parseRunId}</p>
        )}
      </header>

      <section style={noticeStyle}>
        <strong>新規候補は自動登録されません。</strong>
        <span>
          PDF由来の商品が既存マスタに一致しない場合は、商品マスタへ即時作成せず確認待ちとして表示します。
          既存商品へ紐づける場合は、その既存商品のカテゴリを引き継ぐ前提で確認してください。
        </span>
      </section>

      <section style={cardStyle}>
        <h2 style={{ marginTop: 0 }}>更新サマリー</h2>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 12 }}>
          {tabs.map((tab) => {
            const count = tab === "ALL" ? diffItems.length : (summary[tab] ?? 0);
            const href =
              tab === "ALL"
                ? `/documents/${documentId}/diff`
                : `/documents/${documentId}/diff?classification=${tab}`;
            const isActive = classificationFilter === tab;
            return (
              <a
                key={tab}
                href={href}
                style={{
                  ...tabStyle,
                  background: isActive ? "rgba(0,0,0,0.08)" : "transparent",
                }}
              >
                {tab} ({count})
              </a>
            );
          })}
        </div>
        <ul style={{ display: "grid", gap: 4, margin: 0, paddingLeft: 16 }}>
          {Object.entries(summary).map(([key, count]) => (
            <li key={key}>
              {getClassificationLabel(key)}: {count} 件
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
                  <td
                    colSpan={7}
                    style={{ padding: 24, textAlign: "center", color: "var(--muted)" }}
                  >
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
                <Th>操作</Th>
              </tr>
            </thead>
            <tbody>
              {filteredDiffItems.map((item) => (
                <tr key={item.diffItemId}>
                  <Td>{getClassificationLabel(item.classification)}</Td>
                  <Td muted>{getReasonLabel(item.reason)}</Td>
                  <Td>{item.vendorName ?? "-"}</Td>
                  <Td muted>{formatDate(item.invoiceDate)}</Td>
                  <Td muted>
                    <pre style={preStyle}>{JSON.stringify(item.before, null, 2)}</pre>
                  </Td>
                  <Td muted>
                    <pre style={preStyle}>{JSON.stringify(item.after, null, 2)}</pre>
                  </Td>
                  <Td>
                    {canLinkProduct(item.classification) ? (
                      <a
                        href={`/documents/${documentId}/diff/${item.diffItemId}/link`}
                        style={linkButtonStyle}
                      >
                        既存商品に紐づける
                      </a>
                    ) : (
                      <span style={{ color: "var(--muted)" }}>-</span>
                    )}
                  </Td>
                </tr>
              ))}
              {filteredDiffItems.length === 0 && (
                <tr>
                  <td
                    colSpan={7}
                    style={{ padding: 24, textAlign: "center", color: "var(--muted)" }}
                  >
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

const noticeStyle: CSSProperties = {
  ...cardStyle,
  display: "grid",
  gap: 4,
  borderColor: "var(--color-accent1)",
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

const tabStyle: CSSProperties = {
  padding: "6px 10px",
  borderRadius: "999px",
  border: "1px solid var(--border)",
  color: "inherit",
  textDecoration: "none",
  fontSize: 12,
};

const backLinkStyle: CSSProperties = {
  width: "fit-content",
  color: "var(--text)",
  textDecoration: "none",
  border: "1px solid var(--border)",
  borderRadius: "var(--radius-md)",
  padding: "6px 10px",
  fontSize: 13,
};

const linkButtonStyle: CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  padding: "8px 10px",
  borderRadius: "var(--radius-md)",
  border: "1px solid var(--border)",
  color: "var(--text)",
  textDecoration: "none",
  whiteSpace: "nowrap",
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
