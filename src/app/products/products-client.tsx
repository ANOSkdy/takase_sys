"use client";

import { useEffect, useState } from "react";
import type { CSSProperties, ReactNode } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import type { ProductSearchResult } from "@/services/products/search";

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
  keyword: string;
  category: string;
  vendor: string;
  qualityFlag: string;
  pageSize: string;
};

export default function ProductsClient({ result }: { result: ProductSearchResult }) {
  const router = useRouter();
  const sp = useSearchParams();

  const [form, setForm] = useState<FormState>({
    keyword: "",
    category: "",
    vendor: "",
    qualityFlag: "",
    pageSize: "50",
  });

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setForm({
      keyword: sp.get("keyword") ?? "",
      category: sp.get("category") ?? "",
      vendor: sp.get("vendor") ?? "",
      qualityFlag: sp.get("quality_flag") ?? "",
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

    setIf("keyword", form.keyword);
    setIf("category", form.category);
    setIf("vendor", form.vendor);
    setIf("quality_flag", form.qualityFlag);

    p.set("page", String(Math.min(Math.max(1, nextPage), totalPages)));
    p.set("pageSize", String(pageSize));

    router.push(`/products?${p.toString()}`);
  };

  const onSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    apply(1);
  };

  const clear = () => {
    router.push("/products");
  };

  const from = result.total === 0 ? 0 : (result.page - 1) * result.pageSize + 1;
  const to = Math.min(result.total, result.page * result.pageSize);

  return (
    <section style={{ display: "grid", gap: "var(--space-4)" }}>
      <form onSubmit={onSubmit} style={cardStyle}>
        <h2 style={{ marginTop: 0 }}>検索</h2>
        <div style={grid2}>
          <Field
            label="キーワード"
            value={form.keyword}
            onChange={(v) => setForm({ ...form, keyword: v })}
          />
          <Field
            label="カテゴリ"
            value={form.category}
            onChange={(v) => setForm({ ...form, category: v })}
          />
        </div>
        <div style={grid2}>
          <Field
            label="ベンダー"
            value={form.vendor}
            onChange={(v) => setForm({ ...form, vendor: v })}
          />
          <Field
            label="品質フラグ"
            value={form.qualityFlag}
            onChange={(v) => setForm({ ...form, qualityFlag: v })}
          />
        </div>
        <div style={{ display: "flex", gap: "var(--space-2)", alignItems: "center" }}>
          <label style={{ fontSize: 12, color: "var(--muted)" }}>件数</label>
          <select
            value={form.pageSize}
            onChange={(e) => setForm({ ...form, pageSize: e.target.value })}
            style={{ ...inputStyle, height: 36, width: 120 }}
          >
            {[20, 50, 100].map((n) => (
              <option key={n} value={String(n)}>
                {n}件
              </option>
            ))}
          </select>
        </div>
        <div style={{ display: "flex", gap: "var(--space-2)" }}>
          <button style={btnPrimary} type="submit">
            検索
          </button>
          <button style={btnSecondary} type="button" onClick={clear}>
            クリア
          </button>
        </div>
      </form>

      <div style={cardStyle}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
          <h2 style={{ margin: 0 }}>一覧</h2>
          <div style={{ color: "var(--muted)" }}>
            {from}-{to} / {result.total}
          </div>
        </div>
        <div style={{ overflowX: "auto", marginTop: "var(--space-3)" }}>
          <table style={tableStyle}>
            <thead>
              <tr>
                <Th>品名</Th>
                <Th>規格</Th>
                <Th>カテゴリ</Th>
                <Th>品質</Th>
                <Th>業者数</Th>
                <Th>最終更新日</Th>
                <Th>詳細</Th>
              </tr>
            </thead>
            <tbody>
              {result.items.map((item) => (
                <tr key={item.productId}>
                  <Td>{item.productName}</Td>
                  <Td muted>{item.spec ?? "-"}</Td>
                  <Td muted>{item.category ?? "-"}</Td>
                  <Td>{item.qualityFlag}</Td>
                  <Td>{item.vendorCount}</Td>
                  <Td muted>{item.lastUpdatedOn ? formatDate(item.lastUpdatedOn) : "-"}</Td>
                  <Td>
                    <a
                      href={`/products/${item.productId}`}
                      style={{ ...btnSecondary, textDecoration: "none" }}
                    >
                      詳細
                    </a>
                  </Td>
                </tr>
              ))}
              {result.items.length === 0 && (
                <tr>
                  <td colSpan={7} style={{ padding: 24, textAlign: "center", color: "var(--muted)" }}>
                    条件に一致する商品がありません。
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        <div style={{ display: "flex", gap: "var(--space-2)", marginTop: "var(--space-3)" }}>
          <button
            style={btnSecondary}
            type="button"
            onClick={() => apply(Math.max(1, page - 1))}
            disabled={page <= 1}
          >
            前へ
          </button>
          <span style={{ alignSelf: "center" }}>
            {page} / {totalPages}
          </span>
          <button
            style={btnSecondary}
            type="button"
            onClick={() => apply(Math.min(totalPages, page + 1))}
            disabled={page >= totalPages}
          >
            次へ
          </button>
        </div>
      </div>
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
  onChange: (next: string) => void;
}) {
  return (
    <div style={{ display: "grid", gap: "var(--space-2)" }}>
      <label style={{ fontSize: 12, color: "var(--muted)" }}>{label}</label>
      <input value={value} onChange={(e) => onChange(e.target.value)} style={inputStyle} />
    </div>
  );
}

const grid2 = {
  display: "grid",
  gap: "var(--space-3)",
  gridTemplateColumns: "repeat(auto-fit,minmax(220px,1fr))",
};

const inputStyle = {
  border: "1px solid var(--border)",
  borderRadius: 10,
  padding: "10px 12px",
  background: "var(--surface)",
};

const btnPrimary = {
  border: "none",
  borderRadius: 8,
  padding: "10px 14px",
  background: "var(--primary)",
  color: "white",
  cursor: "pointer",
};

const btnSecondary = {
  border: "1px solid var(--border)",
  borderRadius: 8,
  padding: "8px 12px",
  background: "transparent",
  cursor: "pointer",
  color: "inherit",
};

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
