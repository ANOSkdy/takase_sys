"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import type { RecordRow, RecordSearchResult } from "@/services/records/search";

type ApiProblem = {
  title?: string;
  detail?: string;
  errors?: {
    fieldErrors?: Record<string, string[]>;
  };
};

function formatYen(n: number) {
  if (!Number.isFinite(n)) return "-";
  return new Intl.NumberFormat("ja-JP").format(n);
}
function formatDate(iso: string | null) {
  if (!iso) return "-";
  if (!/^\d{4}-\d{2}-\d{2}$/.test(iso)) return "-";
  return iso.replaceAll("-", "/");
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

type EditFormState = {
  productName: string;
  spec: string;
  category: string;
  vendorName: string;
  unitPrice: string;
  priceUpdatedOn: string;
};

export default function RecordsSearchClient({ result }: { result: RecordSearchResult }) {
  const router = useRouter();
  const sp = useSearchParams();

  const [desktopOpen, setDesktopOpen] = useState(true);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [items, setItems] = useState<RecordRow[]>(result.items);
  const [rowRestoreTarget, setRowRestoreTarget] = useState<HTMLElement | null>(null);

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
    setItems(result.items);
  }, [result.items]);

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

  const editId = sp.get("edit");
  const activeRecord = editId ? (items.find((item) => item.recordId === editId) ?? null) : null;

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

  const openEdit = (item: RecordRow, rowElement: HTMLElement) => {
    setRowRestoreTarget(rowElement);
    router.push(`/records?${withParam(sp, { edit: item.recordId })}`);
  };

  const closeEdit = () => {
    router.push(`/records?${withParam(sp, { edit: "" })}`);
    rowRestoreTarget?.focus();
  };

  const handleUpdated = (updated: RecordRow) => {
    setItems((prev) => prev.map((item) => (item.recordId === updated.recordId ? updated : item)));
    closeEdit();
    router.refresh();
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
            {items.map((r) => (
              <tr
                key={r.recordId}
                tabIndex={0}
                role="button"
                onClick={(e) => openEdit(r, e.currentTarget)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    openEdit(r, e.currentTarget);
                  }
                }}
                style={{ cursor: "pointer" }}
              >
                <Td>{r.productName}</Td>
                <Td muted>{r.spec ?? "-"}</Td>
                <Td align="right">{formatYen(r.unitPrice)}</Td>
                <Td>{r.vendorName}</Td>
                <Td>{formatDate(r.lastUpdatedOn)}</Td>
                <Td muted>{r.category ?? "-"}</Td>
              </tr>
            ))}
            {items.length === 0 && (
              <tr>
                <td colSpan={6} style={{ padding: 24, textAlign: "center", color: "var(--muted)" }}>
                  条件に一致するレコードがありません。
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {activeRecord && (
        <RecordEditModal record={activeRecord} onClose={closeEdit} onUpdated={handleUpdated} />
      )}

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

function RecordEditModal({
  record,
  onClose,
  onUpdated,
}: {
  record: RecordRow;
  onClose: () => void;
  onUpdated: (record: RecordRow) => void;
}) {
  const [form, setForm] = useState<EditFormState>({
    productName: record.productName,
    spec: record.spec ?? "",
    category: record.category ?? "",
    vendorName: record.vendorName,
    unitPrice: String(record.unitPrice),
    priceUpdatedOn: record.priceUpdatedOn ?? "",
  });
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string[]>>({});
  const productNameRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    productNameRef.current?.focus();
  }, []);

  useEffect(() => {
    const fetchLatest = async () => {
      setLoading(true);
      setErrorMessage(null);

      try {
        const res = await fetch(`/api/records/${record.recordId}`, { cache: "no-store" });
        if (!res.ok) {
          setLoading(false);
          return;
        }
        const latest = (await res.json()) as RecordRow;
        setForm({
          productName: latest.productName,
          spec: latest.spec ?? "",
          category: latest.category ?? "",
          vendorName: latest.vendorName,
          unitPrice: String(latest.unitPrice),
          priceUpdatedOn: latest.priceUpdatedOn ?? "",
        });
      } catch {
        // no-op: keep initial data
      } finally {
        setLoading(false);
      }
    };

    void fetchLatest();
  }, [record.recordId]);

  useEffect(() => {
    const onEsc = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !busy) onClose();
    };
    window.addEventListener("keydown", onEsc);
    return () => window.removeEventListener("keydown", onEsc);
  }, [busy, onClose]);

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setErrorMessage(null);
    setFieldErrors({});

    try {
      const res = await fetch(`/api/records/${record.recordId}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          productName: form.productName,
          spec: form.spec,
          category: form.category,
          vendorName: form.vendorName,
          unitPrice: form.unitPrice,
          priceUpdatedOn: form.priceUpdatedOn || null,
        }),
      });

      if (!res.ok) {
        const problem = (await res.json().catch(() => null)) as ApiProblem | null;
        setErrorMessage(problem?.detail ?? "更新に失敗しました。入力内容を確認してください。");
        setFieldErrors(problem?.errors?.fieldErrors ?? {});
        return;
      }

      const updated = (await res.json()) as RecordRow;
      onUpdated(updated);
    } catch {
      setErrorMessage("通信エラーが発生しました。時間をおいて再度お試しください。");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div style={modalBackdrop} role="dialog" aria-modal="true" onClick={() => !busy && onClose()}>
      <div style={modalPanel} onClick={(e) => e.stopPropagation()}>
        <h3 style={{ marginTop: 0 }}>レコード編集</h3>

        {loading && <p style={{ color: "var(--muted)", marginTop: 0 }}>最新データを確認中...</p>}

        <form onSubmit={save} style={{ display: "grid", gap: "var(--space-3)" }}>
          <Field
            label="品名"
            value={form.productName}
            onChange={(v) => setForm({ ...form, productName: v })}
            error={fieldErrors.productName?.[0]}
            inputRef={productNameRef}
          />
          <Field
            label="規格"
            value={form.spec}
            onChange={(v) => setForm({ ...form, spec: v })}
            error={fieldErrors.spec?.[0]}
          />
          <Field
            label="カテゴリ"
            value={form.category}
            onChange={(v) => setForm({ ...form, category: v })}
            error={fieldErrors.category?.[0]}
          />
          <Field
            label="ベンダー"
            value={form.vendorName}
            onChange={(v) => setForm({ ...form, vendorName: v })}
            error={fieldErrors.vendorName?.[0]}
          />
          <Field
            label="価格"
            value={form.unitPrice}
            onChange={(v) => setForm({ ...form, unitPrice: v })}
            error={fieldErrors.unitPrice?.[0]}
          />
          <div style={{ display: "grid", gap: "var(--space-2)" }}>
            <label style={{ fontSize: 12, color: "var(--muted)" }}>価格更新日</label>
            <input
              type="date"
              value={form.priceUpdatedOn}
              onChange={(e) => setForm({ ...form, priceUpdatedOn: e.target.value })}
              style={inputStyle}
            />
            {fieldErrors.priceUpdatedOn?.[0] && (
              <p style={{ margin: 0, color: "var(--color-danger)", fontSize: 12 }}>
                {fieldErrors.priceUpdatedOn[0]}
              </p>
            )}
          </div>

          {errorMessage && (
            <p style={{ margin: 0, color: "var(--color-danger)" }}>{errorMessage}</p>
          )}

          <div style={{ display: "flex", justifyContent: "flex-end", gap: "var(--space-2)" }}>
            <button type="button" style={btnSecondary} onClick={onClose} disabled={busy}>
              キャンセル
            </button>
            <button type="submit" style={btnPrimary} disabled={busy}>
              {busy ? "更新中..." : "更新"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

function Field({
  label,
  value,
  onChange,
  error,
  inputRef,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  error?: string;
  inputRef?: React.RefObject<HTMLInputElement | null>;
}) {
  return (
    <div style={{ display: "grid", gap: "var(--space-2)" }}>
      <label style={{ fontSize: 12, color: "var(--muted)" }}>{label}</label>
      <input
        ref={inputRef}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        style={inputStyle}
      />
      {error && <p style={{ margin: 0, color: "var(--color-danger)", fontSize: 12 }}>{error}</p>}
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
  border: "1px solid var(--border)",
  background: "rgba(0,0,0,0.04)",
  padding: "10px 12px",
  borderRadius: "var(--radius-md)",
  fontSize: 14,
  fontWeight: 700,
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
  zIndex: 20,
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

const modalBackdrop: React.CSSProperties = {
  position: "fixed",
  inset: 0,
  background: "rgba(0,0,0,0.35)",
  display: "grid",
  placeItems: "center",
  padding: "var(--space-4)",
  zIndex: 30,
};

const modalPanel: React.CSSProperties = {
  width: "min(640px, 100%)",
  maxHeight: "85vh",
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
