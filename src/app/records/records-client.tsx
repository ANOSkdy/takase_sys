"use client";

import { useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import type { RecordSearchResult } from "@/services/records/search";

function formatYen(n: number) {
  if (!Number.isFinite(n)) return "-";
  return new Intl.NumberFormat("ja-JP").format(n);
}
const jstDateFormatter = new Intl.DateTimeFormat("ja-JP", {
  timeZone: "Asia/Tokyo",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

function formatDate(iso: string | null) {
  if (!iso) return "-";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "-";
  return jstDateFormatter.format(date);
}

type FormState = {
  q: string;
  name: string;
  spec: string;
  vendor: string;
  category: string;
  priceMin: string;
  priceMax: string;
  updatedFrom: string;
  updatedTo: string;
  pageSize: string;
};

export default function RecordsSearchClient({ result }: { result: RecordSearchResult }) {
  const router = useRouter();
  const sp = useSearchParams();

  const [desktopOpen, setDesktopOpen] = useState(true);
  const [drawerOpen, setDrawerOpen] = useState(false);

  const [form, setForm] = useState<FormState>({
    q: "",
    name: "",
    spec: "",
    vendor: "",
    category: "",
    priceMin: "",
    priceMax: "",
    updatedFrom: "",
    updatedTo: "",
    pageSize: "50",
  });

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setForm({
      q: sp.get("q") ?? "",
      name: sp.get("name") ?? "",
      spec: sp.get("spec") ?? "",
      vendor: sp.get("vendor") ?? "",
      category: sp.get("category") ?? "",
      priceMin: sp.get("priceMin") ?? "",
      priceMax: sp.get("priceMax") ?? "",
      updatedFrom: sp.get("updatedFrom") ?? "",
      updatedTo: sp.get("updatedTo") ?? "",
      pageSize: sp.get("pageSize") ?? "50",
    });
  }, [sp]);

  const page = Number(sp.get("page") ?? "1");
  const pageSize = Number(sp.get("pageSize") ?? form.pageSize ?? "50");
  const totalPages = Math.max(1, Math.ceil(result.total / Math.max(1, pageSize)));

  const apply = (nextPage: number) => {
    const p = new URLSearchParams();

    const setIf = (k: string, v: string) => {
      const vv = v.trim();
      if (vv) p.set(k, vv);
    };

    setIf("q", form.q);
    setIf("name", form.name);
    setIf("spec", form.spec);
    setIf("vendor", form.vendor);
    setIf("category", form.category);
    setIf("priceMin", form.priceMin);
    setIf("priceMax", form.priceMax);
    setIf("updatedFrom", form.updatedFrom);
    setIf("updatedTo", form.updatedTo);

    p.set("page", String(Math.min(Math.max(1, nextPage), totalPages)));
    p.set("pageSize", String(pageSize));

    router.push(`/records?${p.toString()}`);
  };

  const onSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setDrawerOpen(false);
    apply(1);
  };

  const clear = () => {
    setDrawerOpen(false);
    router.push("/records");
  };

  const from = result.total === 0 ? 0 : (result.page - 1) * result.pageSize + 1;
  const to = Math.min(result.total, result.page * result.pageSize);

  const Filters = (
    <form onSubmit={onSubmit} style={{ display: "grid", gap: "var(--space-3)" }}>
      <div style={{ display: "grid", gap: "var(--space-2)" }}>
        <label style={{ fontSize: 12, color: "var(--muted)" }}>フリーワード（あいまい検索）</label>
        <input
          value={form.q}
          onChange={(e) => setForm({ ...form, q: e.target.value })}
          placeholder="例：バルブ 20A / 山田商事 など"
          style={inputStyle}
        />
      </div>

      <div style={{ display: "grid", gap: "var(--space-2)" }}>
        <label style={{ fontSize: 12, color: "var(--muted)" }}>カテゴリ</label>
        <select
          value={form.category}
          onChange={(e) => setForm({ ...form, category: e.target.value })}
          style={{ ...inputStyle, height: 40 }}
        >
          <option value="">すべてのカテゴリ</option>
          {result.categories.map((category) => (
            <option key={category} value={category}>
              {category}
            </option>
          ))}
        </select>
      </div>

      <div style={grid2}>
        <Field label="品名" value={form.name} onChange={(v) => setForm({ ...form, name: v })} />
        <Field label="規格" value={form.spec} onChange={(v) => setForm({ ...form, spec: v })} />
        <Field
          label="ベンダー"
          value={form.vendor}
          onChange={(v) => setForm({ ...form, vendor: v })}
        />
      </div>

      <div style={grid2}>
        <div style={{ display: "grid", gap: "var(--space-2)" }}>
          <label style={{ fontSize: 12, color: "var(--muted)" }}>価格（最小）</label>
          <input
            inputMode="numeric"
            value={form.priceMin}
            onChange={(e) => setForm({ ...form, priceMin: e.target.value })}
            placeholder="例：100"
            style={inputStyle}
          />
        </div>
        <div style={{ display: "grid", gap: "var(--space-2)" }}>
          <label style={{ fontSize: 12, color: "var(--muted)" }}>価格（最大）</label>
          <input
            inputMode="numeric"
            value={form.priceMax}
            onChange={(e) => setForm({ ...form, priceMax: e.target.value })}
            placeholder="例：10000"
            style={inputStyle}
          />
        </div>
      </div>

      <div style={grid2}>
        <div style={{ display: "grid", gap: "var(--space-2)" }}>
          <label style={{ fontSize: 12, color: "var(--muted)" }}>最終更新日（From）</label>
          <input
            type="date"
            value={form.updatedFrom}
            onChange={(e) => setForm({ ...form, updatedFrom: e.target.value })}
            style={inputStyle}
          />
        </div>
        <div style={{ display: "grid", gap: "var(--space-2)" }}>
          <label style={{ fontSize: 12, color: "var(--muted)" }}>最終更新日（To）</label>
          <input
            type="date"
            value={form.updatedTo}
            onChange={(e) => setForm({ ...form, updatedTo: e.target.value })}
            style={inputStyle}
          />
        </div>
      </div>

      <div
        style={{
          display: "flex",
          gap: "var(--space-2)",
          justifyContent: "space-between",
          alignItems: "center",
        }}
      >
        <div style={{ display: "flex", gap: "var(--space-2)", alignItems: "center" }}>
          <span style={{ fontSize: 12, color: "var(--muted)" }}>表示件数</span>
          <select
            value={String(pageSize)}
            onChange={(e) =>
              router.push(`/records?${withParam(sp, { page: "1", pageSize: e.target.value })}`)
            }
            style={{ ...inputStyle, height: 36, padding: "0 10px" }}
          >
            <option value="20">20</option>
            <option value="50">50</option>
            <option value="100">100</option>
          </select>
        </div>

        <div style={{ display: "flex", gap: "var(--space-2)" }}>
          <button type="button" onClick={clear} style={btnSecondary}>
            クリア
          </button>
          <button type="submit" style={btnPrimary}>
            検索
          </button>
        </div>
      </div>
    </form>
  );

  return (
    <section style={{ display: "grid", gap: "var(--space-4)" }}>
      <div className="filtersDesktop" style={cardStyle}>
        <button
          type="button"
          onClick={() => setDesktopOpen((prev) => !prev)}
          style={accordionButton}
          aria-expanded={desktopOpen}
        >
          <span>フィルタ</span>
          <span aria-hidden="true">{desktopOpen ? "−" : "+"}</span>
        </button>
        {desktopOpen && <div style={{ marginTop: "var(--space-3)" }}>{Filters}</div>}
      </div>

      <div className="filtersMobile" style={{ display: "none" }}>
        <button style={btnPrimary} onClick={() => setDrawerOpen(true)}>
          フィルタ
        </button>
      </div>

      {drawerOpen && (
        <div
          role="dialog"
          aria-modal="true"
          style={drawerBackdrop}
          onClick={() => setDrawerOpen(false)}
        >
          <div style={drawerPanel} onClick={(e) => e.stopPropagation()}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <strong>フィルタ</strong>
              <button style={btnSecondary} onClick={() => setDrawerOpen(false)}>
                閉じる
              </button>
            </div>
            <div style={{ marginTop: "var(--space-3)" }}>{Filters}</div>
          </div>
        </div>
      )}

      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <div style={{ color: "var(--muted)" }}>
          {from}–{to} / {result.total} 件
        </div>

        <div style={{ display: "flex", gap: "var(--space-2)" }}>
          <button style={btnSecondary} disabled={page <= 1} onClick={() => apply(page - 1)}>
            前へ
          </button>
          <span style={{ alignSelf: "center", color: "var(--muted)" }}>
            {page} / {totalPages}
          </span>
          <button
            style={btnSecondary}
            disabled={page >= totalPages}
            onClick={() => apply(page + 1)}
          >
            次へ
          </button>
        </div>
      </div>

      <div style={{ overflowX: "auto", background: "transparent" }}>
        <table style={tableStyle}>
          <thead>
            <tr>
              <Th>品名</Th>
              <Th>規格</Th>
              <Th align="right">価格</Th>
              <Th>ベンダー</Th>
              <Th>最終更新日</Th>
              <Th>カテゴリ</Th>
            </tr>
          </thead>
          <tbody>
            {result.items.map((r) => (
              <tr key={`${r.productId}:${r.vendorName}`}>
                <Td>{r.productName}</Td>
                <Td muted>{r.spec ?? "-"}</Td>
                <Td align="right">{formatYen(r.unitPrice)}</Td>
                <Td>{r.vendorName}</Td>
                <Td>{formatDate(r.lastUpdatedOn)}</Td>
                <Td muted>{r.category ?? "-"}</Td>
              </tr>
            ))}
            {result.items.length === 0 && (
              <tr>
                <td colSpan={6} style={{ padding: 24, textAlign: "center", color: "var(--muted)" }}>
                  条件に一致するレコードがありません。
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <style jsx>{`
        @media (max-width: 840px) {
          .filtersDesktop {
            display: none;
          }
          .filtersMobile {
            display: block !important;
          }
        }
      `}</style>
    </section>
  );
}

function Field({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <div style={{ display: "grid", gap: "var(--space-2)" }}>
      <label style={{ fontSize: 12, color: "var(--muted)" }}>{label}</label>
      <input value={value} onChange={(e) => onChange(e.target.value)} style={inputStyle} />
    </div>
  );
}

function withParam(sp: ReturnType<typeof useSearchParams>, patch: Record<string, string>) {
  const p = new URLSearchParams(sp.toString());
  for (const [k, v] of Object.entries(patch)) {
    if (!v) p.delete(k);
    else p.set(k, v);
  }
  return p.toString();
}

const cardStyle: React.CSSProperties = {
  background: "var(--surface)",
  border: "1px solid var(--border)",
  borderRadius: "var(--radius-lg)",
  boxShadow: "var(--shadow-soft)",
  padding: "var(--space-4)",
};

const inputStyle: React.CSSProperties = {
  height: 40,
  borderRadius: "var(--radius-md)",
  border: "1px solid var(--border)",
  padding: "0 12px",
  outline: "none",
  background: "var(--surface)",
};

const btnPrimary: React.CSSProperties = {
  height: 36,
  padding: "0 12px",
  borderRadius: "var(--radius-md)",
  border: "none",
  background: "var(--color-primary)",
  color: "#fff",
  cursor: "pointer",
};

const btnSecondary: React.CSSProperties = {
  height: 36,
  padding: "0 12px",
  borderRadius: "var(--radius-md)",
  border: "1px solid var(--border)",
  background: "transparent",
  color: "var(--text)",
  cursor: "pointer",
};

const accordionButton: React.CSSProperties = {
  width: "100%",
  display: "flex",
  justifyContent: "space-between",
  alignItems: "center",
  gap: "var(--space-2)",
  border: "none",
  background: "transparent",
  padding: 0,
  fontSize: 14,
  fontWeight: 600,
  cursor: "pointer",
  color: "var(--text)",
};

const grid2: React.CSSProperties = {
  display: "grid",
  gap: "var(--space-3)",
  gridTemplateColumns: "1fr 1fr",
};

const drawerBackdrop: React.CSSProperties = {
  position: "fixed",
  inset: 0,
  background: "rgba(0,0,0,0.35)",
  display: "grid",
  placeItems: "end",
  padding: "var(--space-4)",
};

const drawerPanel: React.CSSProperties = {
  width: "min(920px, 100%)",
  maxHeight: "80vh",
  overflow: "auto",
  background: "var(--surface)",
  borderRadius: "var(--radius-lg)",
  boxShadow: "var(--shadow-soft)",
  padding: "var(--space-4)",
};

const tableStyle: React.CSSProperties = {
  width: "100%",
  borderCollapse: "separate",
  borderSpacing: 0,
  background: "var(--surface)",
  border: "1px solid var(--border)",
  borderRadius: "var(--radius-lg)",
  overflow: "hidden",
};

function Th({ children, align }: { children: React.ReactNode; align?: "left" | "right" }) {
  return (
    <th
      style={{
        textAlign: align ?? "left",
        padding: "12px 12px",
        fontSize: 12,
        color: "var(--muted)",
        borderBottom: "1px solid var(--border)",
        background: "rgba(0,0,0,0.02)",
        whiteSpace: "nowrap",
      }}
    >
      {children}
    </th>
  );
}

function Td({
  children,
  muted,
  align,
}: {
  children: React.ReactNode;
  muted?: boolean;
  align?: "left" | "right";
}) {
  return (
    <td
      style={{
        padding: "12px 12px",
        borderBottom: "1px solid rgba(0,0,0,0.06)",
        color: muted ? "var(--muted)" : "var(--text)",
        textAlign: align ?? "left",
        verticalAlign: "top",
      }}
    >
      {children}
    </td>
  );
}
