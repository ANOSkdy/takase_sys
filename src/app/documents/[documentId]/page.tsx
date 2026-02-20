import Link from "next/link";
import { notFound } from "next/navigation";
import type { CSSProperties } from "react";
import { getDocumentDetail } from "@/services/documents/repository";
import { isParseRunCompleted } from "@/services/documents/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export default async function DocumentDetailPage({
  params,
}: {
  params: Promise<{ documentId: string }>;
}) {
  const { documentId } = await params;
  const doc = await getDocumentDetail(documentId);

  if (!doc) {
    notFound();
  }

  const latestStats = doc.latestParseRun?.stats;

  return (
    <main style={{ padding: "var(--space-6)", display: "grid", gap: "var(--space-4)" }}>
      <header style={{ display: "grid", gap: "var(--space-2)" }}>
        <Link href="/documents" style={backLinkStyle}>
          ← 一覧へ戻る
        </Link>
        <h1 style={{ margin: 0 }}>{doc.fileName}</h1>
      </header>

      {doc.status === "PARSED_PARTIAL" && (doc.parseErrorSummary || latestStats) && (
        <section style={warningStyle}>
          <h2 style={{ margin: 0, fontSize: 18 }}>解析一部失敗</h2>
          {doc.parseErrorSummary && <p style={{ margin: "8px 0 0" }}>{doc.parseErrorSummary}</p>}
          {latestStats && (
            <ul style={{ margin: "8px 0 0", paddingLeft: 18 }}>
              <li>processedPages: {latestStats.processedPages ?? "-"}</li>
              <li>succeededPages: {latestStats.succeededPages ?? "-"}</li>
              <li>failedPages: {latestStats.failedPages ?? "-"}</li>
              <li>failedPageNos: {latestStats.failedPageNos?.join(", ") || "-"}</li>
            </ul>
          )}
        </section>
      )}

      {doc.latestParseRun && (
        <section style={cardStyle}>
          <h2 style={{ marginTop: 0 }}>最新解析実行</h2>
          <p style={{ margin: "8px 0 0" }}>
            ステータス: {doc.latestParseRun.status}
            {isParseRunCompleted(doc.latestParseRun.status) ? "（完了）" : "（進行中）"}
          </p>
        </section>
      )}

      <section style={cardStyle}>
        <h2 style={{ marginTop: 0 }}>表示</h2>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <a href={`/api/documents/${doc.documentId}/line-items`} style={btnLink}>
            明細ビュー
          </a>
          <a href={`/documents/${doc.documentId}/diff`} style={btnLink}>
            差分ビュー
          </a>
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

const warningStyle: CSSProperties = {
  ...cardStyle,
  border: "1px solid rgba(217,119,6,0.45)",
  background: "rgba(245,158,11,0.12)",
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

const btnLink: CSSProperties = {
  height: 36,
  padding: "0 12px",
  borderRadius: "var(--radius-md)",
  border: "1px solid var(--border)",
  background: "rgba(0,0,0,0.02)",
  color: "var(--text)",
  textDecoration: "none",
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
};
