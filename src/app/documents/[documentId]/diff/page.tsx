import Link from "next/link";
import type { CSSProperties } from "react";
import { getDocumentDetail } from "@/services/documents/repository";
import { diffSummary, listDiffItems } from "@/services/documents/parse";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type SearchParams = Record<string, string | string[] | undefined>;

const tabs = [
  { key: "UPDATE", label: "UPDATE" },
  { key: "BLOCKED", label: "BLOCKED" },
  { key: "UNMATCHED", label: "UNMATCHED" },
  { key: "NO_CHANGE", label: "NO_CHANGE" },
  { key: "NEW_CANDIDATE", label: "NEW_CANDIDATE" },
] as const;

function formatConfidence(value: number | null) {
  if (value == null) return "-";
  return `${Math.round(value * 100)}%`;
}

export default async function DocumentDiffPage({
  params,
  searchParams,
}: {
  params: Promise<{ documentId: string }>;
  searchParams?: Promise<SearchParams>;
}) {
  const { documentId } = await params;
  const sp = await (searchParams ?? Promise.resolve({} as SearchParams));
  const parseRunId =
    (Array.isArray(sp.parseRunId) ? sp.parseRunId[0] : sp.parseRunId) ?? null;
  const currentClass = (Array.isArray(sp.class) ? sp.class[0] : sp.class) ?? "UPDATE";

  const doc = await getDocumentDetail(documentId);
  const latestRunId = doc?.latestParseRun?.parseRunId ?? null;
  const runId = parseRunId ?? latestRunId;

  if (!doc || !runId) {
    return (
      <main style={{ padding: "var(--space-6)" }}>
        <h1 style={{ marginBottom: "var(--space-3)" }}>差分結果</h1>
        <p>解析済みのドキュメントが見つかりません。</p>
        <Link href="/documents">ドキュメント一覧へ戻る</Link>
      </main>
    );
  }

  const [summary, items] = await Promise.all([
    diffSummary(documentId, runId),
    listDiffItems(documentId, runId, currentClass),
  ]);

  return (
    <main style={{ padding: "var(--space-6)", display: "grid", gap: "var(--space-4)" }}>
      <header style={{ display: "grid", gap: "var(--space-2)" }}>
        <Link href="/documents">← ドキュメント一覧</Link>
        <h1 style={{ margin: 0 }}>差分結果</h1>
        <p style={{ margin: 0, color: "var(--muted)" }}>
          対象: {doc.fileName} / Parse Run: {runId}
        </p>
      </header>

      <section style={{ display: "grid", gap: "var(--space-2)" }}>
        <h2 style={{ margin: 0 }}>Summary</h2>
        <div style={{ display: "flex", flexWrap: "wrap", gap: "var(--space-3)" }}>
          <SummaryChip label="UPDATE" value={summary.update} />
          <SummaryChip label="BLOCKED" value={summary.blocked} />
          <SummaryChip label="UNMATCHED" value={summary.unmatched} />
          <SummaryChip label="NO_CHANGE" value={summary.noChange} />
          <SummaryChip label="NEW_CANDIDATE" value={summary.newCandidate} />
        </div>
      </section>

      <nav style={{ display: "flex", gap: "var(--space-2)", flexWrap: "wrap" }}>
        {tabs.map((tab) => {
          const active = tab.key === currentClass;
          const href = `/documents/${documentId}/diff?parseRunId=${runId}&class=${tab.key}`;
          return (
            <Link key={tab.key} href={href} style={tabStyle(active)}>
              {tab.label}
            </Link>
          );
        })}
      </nav>

      <section style={{ display: "grid", gap: "var(--space-3)" }}>
        {items.length === 0 ? (
          <p style={{ color: "var(--muted)" }}>該当する差分はありません。</p>
        ) : (
          items.map((item) => (
            <div key={item.diffItemId} style={cardStyle}>
              <div style={{ display: "flex", justifyContent: "space-between", gap: "var(--space-2)" }}>
                <strong>
                  #{item.lineNo} {item.productNameRaw ?? "品名なし"}
                </strong>
                <span style={{ color: "var(--muted)" }}>{item.classification}</span>
              </div>
              <div style={{ display: "grid", gap: 6, marginTop: "var(--space-2)" }}>
                <div>規格: {item.specRaw ?? "-"}</div>
                <div>システム信頼度: {formatConfidence(item.systemConfidence)}</div>
                <div>理由: {item.reason ?? "-"}</div>
              </div>
              <div style={{ display: "grid", gap: 6, marginTop: "var(--space-2)" }}>
                <div style={{ color: "var(--muted)" }}>Before</div>
                <pre style={preStyle}>{JSON.stringify(item.before, null, 2)}</pre>
                <div style={{ color: "var(--muted)" }}>After</div>
                <pre style={preStyle}>{JSON.stringify(item.after, null, 2)}</pre>
              </div>
            </div>
          ))
        )}
      </section>
    </main>
  );
}

function SummaryChip({ label, value }: { label: string; value: number }) {
  return (
    <span
      style={{
        border: "1px solid var(--border)",
        borderRadius: 999,
        padding: "4px 10px",
        fontSize: 12,
        background: "var(--surface)",
      }}
    >
      {label}: {value}
    </span>
  );
}

function tabStyle(active: boolean): CSSProperties {
  return {
    padding: "6px 12px",
    borderRadius: 999,
    border: "1px solid var(--border)",
    background: active ? "var(--surface-strong)" : "transparent",
    textDecoration: "none",
    color: "inherit",
    fontSize: 13,
  };
}

const cardStyle: CSSProperties = {
  border: "1px solid var(--border)",
  borderRadius: 12,
  padding: "var(--space-3)",
  background: "var(--surface)",
};

const preStyle: CSSProperties = {
  background: "var(--surface-strong)",
  padding: "var(--space-2)",
  borderRadius: 8,
  fontSize: 12,
  overflowX: "auto",
};
