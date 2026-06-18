"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import type { RecordRow, RecordSearchResult } from "@/services/records/search";
import styles from "./records.module.css";

type ApiProblem = {
  title?: string;
  detail?: string;
  errors?: {
    fieldErrors?: Record<string, string[]>;
  };
};

function formatYen(n: number | null) {
  if (n == null || !Number.isFinite(n)) return "未登録";
  return new Intl.NumberFormat("ja-JP").format(n);
}
function canEditRecord(record: RecordRow) {
  return !record.recordId.startsWith("product:");
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
  productMaker: string;
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
  const isNewMode = sp.get("new") !== null;
  const activeRecord = editId
    ? (items.find((item) => item.recordId === editId && canEditRecord(item)) ?? null)
    : null;

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
    if (!canEditRecord(item)) return;
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
    <form onSubmit={onSubmit} className={styles.filtersForm}>
      <div className={styles.filterRowPrimary}>
        <label className={styles.field}>
          <span>フリーワード（あいまい検索）</span>
          <input
            className={styles.input}
            value={form.q}
            onChange={(e) => setForm({ ...form, q: e.target.value })}
            placeholder="例：バルブ 20A / 山田商事 など"
          />
        </label>
        <label className={styles.field}>
          <span>カテゴリ</span>
          <select
            className={styles.select}
            value={form.category}
            onChange={(e) => setForm({ ...form, category: e.target.value })}
          >
            <option value="">すべてのカテゴリ</option>
            {result.categories.map((category) => (
              <option key={category} value={category}>
                {category}
              </option>
            ))}
          </select>
        </label>
        <Field
          label="ベンダー"
          value={form.vendor}
          onChange={(v) => setForm({ ...form, vendor: v })}
        />
      </div>

      <div className={styles.filterRowSecondary}>
        <Field label="品名" value={form.name} onChange={(v) => setForm({ ...form, name: v })} />
        <Field label="規格" value={form.spec} onChange={(v) => setForm({ ...form, spec: v })} />
        <label className={styles.field}>
          <span>価格（最小）</span>
          <input
            className={styles.input}
            inputMode="numeric"
            value={form.priceMin}
            onChange={(e) => setForm({ ...form, priceMin: e.target.value })}
            placeholder="例：100"
          />
        </label>
        <label className={styles.field}>
          <span>価格（最大）</span>
          <input
            className={styles.input}
            inputMode="numeric"
            value={form.priceMax}
            onChange={(e) => setForm({ ...form, priceMax: e.target.value })}
            placeholder="例：10000"
          />
        </label>
        <label className={styles.field}>
          <span>更新日（From）</span>
          <input
            className={styles.input}
            type="date"
            value={form.updatedFrom}
            onChange={(e) => setForm({ ...form, updatedFrom: e.target.value })}
          />
        </label>
        <label className={styles.field}>
          <span>更新日（To）</span>
          <input
            className={styles.input}
            type="date"
            value={form.updatedTo}
            onChange={(e) => setForm({ ...form, updatedTo: e.target.value })}
          />
        </label>
      </div>

      <div className={styles.filterActions}>
        <label className={styles.pageSizeControl}>
          <span className={styles.inlineLabel}>表示件数</span>
          <select
            className={styles.select}
            value={String(pageSize)}
            onChange={(e) =>
              router.push(`/records?${withParam(sp, { page: "1", pageSize: e.target.value })}`)
            }
          >
            <option value="20">20</option>
            <option value="50">50</option>
            <option value="100">100</option>
          </select>
        </label>
        <div className={styles.buttonGroup}>
          <button type="button" onClick={clear} className={styles.secondaryButton}>
            クリア
          </button>
          <button type="submit" className={styles.primaryButton}>
            検索
          </button>
        </div>
      </div>
    </form>
  );

  return (
    <section className={styles.recordsSection}>
      <header className={styles.hero}>
        <div className={styles.heroText}>
          <span className={styles.totalBadge}>全 {result.total.toLocaleString("ja-JP")} 件</span>
          <h1>仕切り表</h1>
          <p>商品・規格・ベンダー・価格を条件で絞り込み、一覧から編集できます。</p>
        </div>
        <button
          type="button"
          className={styles.primaryButton}
          onClick={() => router.push(`/records?${withParam(sp, { new: "1" })}`)}
        >
          商品追加
        </button>
      </header>

      <div className={`${styles.filterCard} ${styles.desktopFilters}`}>
        <button
          type="button"
          onClick={() => setDesktopOpen((prev) => !prev)}
          className={styles.filterToggle}
          aria-expanded={desktopOpen}
        >
          <span>検索条件</span>
          <span aria-hidden="true">{desktopOpen ? "−" : "+"}</span>
        </button>
        {desktopOpen && Filters}
      </div>

      <div className={styles.mobileFilters}>
        <button className={styles.primaryButton} onClick={() => setDrawerOpen(true)}>
          検索条件を開く
        </button>
      </div>

      {drawerOpen && (
        <div
          role="dialog"
          aria-modal="true"
          className={styles.drawerBackdrop}
          onClick={() => setDrawerOpen(false)}
        >
          <div className={styles.drawerPanel} onClick={(e) => e.stopPropagation()}>
            <div className={styles.drawerHeader}>
              <strong>検索条件</strong>
              <button className={styles.secondaryButton} onClick={() => setDrawerOpen(false)}>
                閉じる
              </button>
            </div>
            {Filters}
          </div>
        </div>
      )}

      <div className={styles.resultToolbar}>
        <div>
          <strong>検索結果</strong>
          <div className={styles.rangeText}>
            {from}–{to} / {result.total.toLocaleString("ja-JP")} 件を表示
          </div>
        </div>
        <div className={styles.pagination}>
          <button
            className={styles.secondaryButton}
            disabled={page <= 1}
            onClick={() => apply(page - 1)}
          >
            前へ
          </button>
          <span className={styles.pageIndicator}>
            {page} / {totalPages}
          </span>
          <button
            className={styles.secondaryButton}
            disabled={page >= totalPages}
            onClick={() => apply(page + 1)}
          >
            次へ
          </button>
        </div>
      </div>

      <div className={styles.tableCard}>
        <table className={styles.table}>
          <thead>
            <tr>
              <Th>品名</Th>
              <Th>規格</Th>
              <Th>メーカー</Th>
              <Th align="right">価格</Th>
              <Th>ベンダー</Th>
              <Th>最終更新日</Th>
              <Th>カテゴリ</Th>
            </tr>
          </thead>
          <tbody>
            {items.map((r) => {
              const editable = canEditRecord(r);

              return (
                <tr
                  key={r.recordId}
                  tabIndex={editable ? 0 : undefined}
                  role={editable ? "button" : undefined}
                  onClick={(e) => openEdit(r, e.currentTarget)}
                  onKeyDown={(e) => {
                    if (!editable) return;
                    if (e.key === "Enter" || e.key === " ") {
                      e.preventDefault();
                      openEdit(r, e.currentTarget);
                    }
                  }}
                  style={{ cursor: editable ? "pointer" : "default" }}
                >
                  <Td>{r.productName}</Td>
                  <Td muted>{r.spec ?? "-"}</Td>
                  <Td muted>{r.productMaker ?? ""}</Td>
                  <Td align="right">{formatYen(r.unitPrice)}</Td>
                  <Td muted={!r.vendorName}>{r.vendorName ?? "未登録"}</Td>
                  <Td>{formatDate(r.lastUpdatedOn)}</Td>
                  <Td muted>{r.category ?? "-"}</Td>
                </tr>
              );
            })}
            {items.length === 0 && (
              <tr>
                <td colSpan={7} style={{ padding: 24, textAlign: "center", color: "var(--muted)" }}>
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
      {isNewMode && (
        <RecordCreateModal
          onClose={() => router.push(`/records?${withParam(sp, { new: "" })}`)}
          onCreated={(created) => {
            setItems((prev) => [created, ...prev]);
            router.push(`/records?${withParam(sp, { new: "" })}`);
            router.refresh();
          }}
        />
      )}
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
    productMaker: record.productMaker ?? "",
    spec: record.spec ?? "",
    category: record.category ?? "",
    vendorName: record.vendorName ?? "",
    unitPrice: record.unitPrice == null ? "" : String(record.unitPrice),
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
          productMaker: latest.productMaker ?? "",
          spec: latest.spec ?? "",
          category: latest.category ?? "",
          vendorName: latest.vendorName ?? "",
          unitPrice: latest.unitPrice == null ? "" : String(latest.unitPrice),
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
          productMaker: form.productMaker,
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
            label="メーカー"
            value={form.productMaker}
            onChange={(v) => setForm({ ...form, productMaker: v })}
            error={fieldErrors.productMaker?.[0]}
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

function RecordCreateModal({
  onClose,
  onCreated,
}: {
  onClose: () => void;
  onCreated: (record: RecordRow) => void;
}) {
  const [form, setForm] = useState<EditFormState>({
    productName: "",
    productMaker: "",
    spec: "",
    category: "",
    vendorName: "",
    unitPrice: "",
    priceUpdatedOn: "",
  });
  const [busy, setBusy] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string[]>>({});
  const productNameRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    productNameRef.current?.focus();
  }, []);

  useEffect(() => {
    const onEsc = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !busy) onClose();
    };
    window.addEventListener("keydown", onEsc);
    return () => window.removeEventListener("keydown", onEsc);
  }, [busy, onClose]);

  const create = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setErrorMessage(null);
    setFieldErrors({});

    try {
      const res = await fetch("/api/records", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          productName: form.productName,
          productMaker: form.productMaker,
          spec: form.spec,
          category: form.category,
          vendorName: form.vendorName,
          unitPrice: form.unitPrice,
          priceUpdatedOn: form.priceUpdatedOn || null,
        }),
      });

      if (!res.ok) {
        const problem = (await res.json().catch(() => null)) as ApiProblem | null;
        setErrorMessage(problem?.detail ?? "登録に失敗しました。入力内容を確認してください。");
        setFieldErrors(problem?.errors?.fieldErrors ?? {});
        return;
      }

      const created = (await res.json()) as RecordRow;
      onCreated(created);
    } catch {
      setErrorMessage("通信エラーが発生しました。時間をおいて再度お試しください。");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div style={modalBackdrop} role="dialog" aria-modal="true" onClick={() => !busy && onClose()}>
      <div style={modalPanel} onClick={(e) => e.stopPropagation()}>
        <h3 style={{ marginTop: 0 }}>新規登録</h3>
        <form onSubmit={create} style={{ display: "grid", gap: "var(--space-3)" }}>
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
            label="メーカー"
            value={form.productMaker}
            onChange={(v) => setForm({ ...form, productMaker: v })}
            error={fieldErrors.productMaker?.[0]}
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
              {busy ? "登録中..." : "登録"}
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
    <div className={styles.field}>
      <label>{label}</label>
      <input
        ref={inputRef}
        className={styles.input}
        value={value}
        onChange={(e) => onChange(e.target.value)}
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

function Th({ children, align }: { children: React.ReactNode; align?: "left" | "right" }) {
  return <th className={align === "right" ? styles.alignRight : undefined}>{children}</th>;
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
    <td className={`${muted ? styles.muted : ""} ${align === "right" ? styles.alignRight : ""}`}>
      {children}
    </td>
  );
}
