"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  Fragment,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
  type FormEvent,
} from "react";
import type { ProductSheetCategory, ProductSheetGrid } from "@/services/records/sheets";
import styles from "./sheets.module.css";

const numberFormat = new Intl.NumberFormat("ja-JP");
const dateRegex = /^\d{4}-\d{2}-\d{2}$/;

type EditableField = "unitPrice" | "priceUpdatedOn";
type DirtyCell = {
  vendorPriceId: string;
  unitPrice?: number | string;
  priceUpdatedOn?: string | null;
};
type ProblemResponse = {
  status?: number;
};
type ProductFormState = {
  productName: string;
  productMaker: string;
  spec: string;
  vendorName: string;
  unitPrice: string;
  priceUpdatedOn: string;
};
type ProductFormErrors = Partial<Record<keyof ProductFormState | "form", string>>;
type ApiErrorResponse = {
  error?: {
    code?: string;
    message?: string;
  };
};

const initialProductForm: ProductFormState = {
  productName: "",
  productMaker: "",
  spec: "",
  vendorName: "",
  unitPrice: "",
  priceUpdatedOn: "",
};

function toDateInputValue(value: string | Date | null | undefined) {
  if (!value) return "";
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (dateRegex.test(trimmed)) return trimmed;
    const parsed = new Date(trimmed);
    if (Number.isNaN(parsed.getTime())) return "";
    return parsed.toISOString().slice(0, 10);
  }
  return value.toISOString().slice(0, 10);
}

function formatPrice(value: string | number | null | undefined) {
  if (value == null) return "-";
  const numeric = Number(value);
  if (Number.isNaN(numeric)) return String(value);
  return numberFormat.format(numeric);
}

function toPriceInputValue(value: string | number | null | undefined) {
  if (value == null) return "";
  return String(value);
}

function normalizePrice(value: string | number | null | undefined) {
  if (value == null || String(value).trim() === "") return null;
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric.toFixed(2) : null;
}

function getSheetHref(category: string, index: number) {
  if (index === 0) return "/records/sheets";
  return `/records/sheets/${encodeURIComponent(category)}`;
}

function getDirtyKey(vendorPriceId: string, field: EditableField) {
  return `${vendorPriceId}:${field}`;
}

function getProblemMessage(problem: ProblemResponse | null) {
  if (problem?.status === 400) return "入力内容を確認してください。";
  if (problem?.status === 404) {
    return "対象データが見つからないか、カテゴリが変更されています。再読み込みしてください。";
  }
  return "保存に失敗しました。時間をおいて再度お試しください。";
}

function getCreateProductErrorMessage(status: number, problem: ApiErrorResponse | null) {
  if (status === 400) return "入力内容を確認してください。";
  if (status === 409 && problem?.error?.code === "PRODUCT_ALREADY_EXISTS") {
    return "同じ品名・規格の商品が既に存在します。";
  }
  return "登録に失敗しました。時間をおいて再度お試しください。";
}

function validateProductForm(form: ProductFormState) {
  const errors: ProductFormErrors = {};
  const productName = form.productName.trim();
  const productMaker = form.productMaker.trim();
  const spec = form.spec.trim();
  const vendorName = form.vendorName.trim();
  const unitPriceText = form.unitPrice.trim();
  const priceUpdatedOn = form.priceUpdatedOn.trim();

  if (!productName) errors.productName = "品名を入力してください。";
  if (productName.length > 300) errors.productName = "品名は300文字以内で入力してください。";
  if (productMaker.length > 200) errors.productMaker = "メーカーは200文字以内で入力してください。";
  if (spec.length > 300) errors.spec = "規格は300文字以内で入力してください。";
  if (vendorName.length > 200) errors.vendorName = "業者名は200文字以内で入力してください。";

  const hasAnyVendorPriceInput = Boolean(vendorName || unitPriceText || priceUpdatedOn);
  if (vendorName && !unitPriceText)
    errors.unitPrice = "業者名を入力した場合は仕切りも入力してください。";
  if (unitPriceText && !vendorName)
    errors.vendorName = "仕切りを入力した場合は業者名も入力してください。";
  if (priceUpdatedOn && (!vendorName || !unitPriceText)) {
    errors.priceUpdatedOn = "最終更新日を登録する場合は業者名と仕切りも入力してください。";
  }
  if (unitPriceText) {
    const unitPrice = Number(unitPriceText);
    if (!Number.isFinite(unitPrice) || unitPrice < 0 || unitPrice > 999999999) {
      errors.unitPrice = "仕切りは0以上999999999以下の数値で入力してください。";
    }
  }
  if (priceUpdatedOn && !dateRegex.test(priceUpdatedOn)) {
    errors.priceUpdatedOn = "最終更新日はYYYY-MM-DD形式で入力してください。";
  }

  return {
    errors,
    values: {
      productName,
      productMaker: productMaker || null,
      spec: spec || null,
      vendorName,
      unitPrice: unitPriceText ? Number(unitPriceText) : null,
      priceUpdatedOn: priceUpdatedOn || null,
      hasVendorPrice: hasAnyVendorPriceInput && Boolean(vendorName && unitPriceText),
    },
  };
}

export default function ProductSheetViewer({
  categories,
  grid,
}: {
  categories: ProductSheetCategory[];
  grid: ProductSheetGrid | null;
}) {
  const router = useRouter();
  const [currentGrid, setCurrentGrid] = useState(grid);
  const [draftValues, setDraftValues] = useState<Record<string, string>>({});
  const [dirtyFields, setDirtyFields] = useState<Set<string>>(() => new Set());
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [isProductFormOpen, setIsProductFormOpen] = useState(false);
  const [isCreatingProduct, setIsCreatingProduct] = useState(false);
  const [productForm, setProductForm] = useState<ProductFormState>(initialProductForm);
  const [productFormErrors, setProductFormErrors] = useState<ProductFormErrors>({});
  const [hasHorizontalOverflow, setHasHorizontalOverflow] = useState(false);
  const topScrollRef = useRef<HTMLDivElement>(null);
  const tableScrollRef = useRef<HTMLDivElement>(null);
  const topSpacerRef = useRef<HTMLDivElement>(null);
  const syncSourceRef = useRef<"top" | "table" | null>(null);

  const updateTopScrollbar = useCallback(() => {
    const topScroll = topScrollRef.current;
    const tableScroll = tableScrollRef.current;
    const topSpacer = topSpacerRef.current;
    if (!topScroll || !tableScroll || !topSpacer) return;

    topSpacer.style.width = `${tableScroll.scrollWidth}px`;
    topScroll.scrollLeft = tableScroll.scrollLeft;
    setHasHorizontalOverflow(tableScroll.scrollWidth > tableScroll.clientWidth + 1);
  }, []);

  function clearSyncSource(source: "top" | "table") {
    requestAnimationFrame(() => {
      if (syncSourceRef.current === source) syncSourceRef.current = null;
    });
  }

  function syncFromTop() {
    const topScroll = topScrollRef.current;
    const tableScroll = tableScrollRef.current;
    if (!topScroll || !tableScroll || syncSourceRef.current === "table") return;

    syncSourceRef.current = "top";
    tableScroll.scrollLeft = topScroll.scrollLeft;
    clearSyncSource("top");
  }

  function syncFromTable() {
    const topScroll = topScrollRef.current;
    const tableScroll = tableScrollRef.current;
    if (!topScroll || !tableScroll || syncSourceRef.current === "top") return;

    syncSourceRef.current = "table";
    topScroll.scrollLeft = tableScroll.scrollLeft;
    clearSyncSource("table");
  }

  useEffect(() => {
    setCurrentGrid(grid);
    setDraftValues({});
    setDirtyFields(new Set());
    setErrorMessage(null);
    setSuccessMessage(null);
  }, [grid]);

  useEffect(() => {
    updateTopScrollbar();

    const tableScroll = tableScrollRef.current;
    if (!tableScroll) return;

    if (typeof ResizeObserver === "undefined") {
      window.addEventListener("resize", updateTopScrollbar);
      return () => window.removeEventListener("resize", updateTopScrollbar);
    }

    const resizeObserver = new ResizeObserver(updateTopScrollbar);
    resizeObserver.observe(tableScroll);
    const table = tableScroll.querySelector("table");
    if (table) resizeObserver.observe(table);

    return () => resizeObserver.disconnect();
  }, [currentGrid, updateTopScrollbar]);

  const dirtyPayload = useMemo(() => {
    if (!currentGrid) return [];

    const cells = new Map<string, DirtyCell>();
    for (const row of currentGrid.rows) {
      for (const vendor of currentGrid.vendors) {
        const price = row.prices[vendor.vendorName];
        if (!price) continue;

        const unitPriceKey = getDirtyKey(price.vendorPriceId, "unitPrice");
        if (dirtyFields.has(unitPriceKey)) {
          cells.set(price.vendorPriceId, {
            ...cells.get(price.vendorPriceId),
            vendorPriceId: price.vendorPriceId,
            unitPrice: draftValues[unitPriceKey] ?? "",
          });
        }

        const priceUpdatedOnKey = getDirtyKey(price.vendorPriceId, "priceUpdatedOn");
        if (dirtyFields.has(priceUpdatedOnKey)) {
          const draftDate = draftValues[priceUpdatedOnKey] ?? "";
          cells.set(price.vendorPriceId, {
            ...cells.get(price.vendorPriceId),
            vendorPriceId: price.vendorPriceId,
            priceUpdatedOn: draftDate.length > 0 ? draftDate : null,
          });
        }
      }
    }

    return Array.from(cells.values());
  }, [currentGrid, dirtyFields, draftValues]);

  const dirtyCount = dirtyFields.size;
  const hasInvalidDirtyPrice = dirtyPayload.some((cell) => {
    if (cell.unitPrice === undefined) return false;
    const numeric = Number(cell.unitPrice);
    return !Number.isFinite(numeric) || numeric < 0 || numeric > 999999999;
  });

  function updateDraft(
    vendorPriceId: string,
    field: EditableField,
    nextValue: string,
    originalValue: string,
  ) {
    const key = getDirtyKey(vendorPriceId, field);
    setErrorMessage(null);
    setSuccessMessage(null);
    setDraftValues((current) => ({ ...current, [key]: nextValue }));
    setDirtyFields((current) => {
      const next = new Set(current);
      if (nextValue === originalValue) {
        next.delete(key);
      } else {
        next.add(key);
      }
      return next;
    });
  }

  function discardChanges() {
    setDraftValues({});
    setDirtyFields(new Set());
    setErrorMessage(null);
    setSuccessMessage(null);
  }

  function openProductForm() {
    if (dirtyCount > 0) {
      setErrorMessage("未保存の変更を保存または破棄してから商品を追加してください。");
      return;
    }
    setProductFormErrors({});
    setProductForm(initialProductForm);
    setIsProductFormOpen(true);
    setErrorMessage(null);
    setSuccessMessage(null);
  }

  function closeProductForm() {
    if (isCreatingProduct) return;
    setIsProductFormOpen(false);
    setProductForm(initialProductForm);
    setProductFormErrors({});
  }

  function updateProductFormField(field: keyof ProductFormState, value: string) {
    setProductForm((current) => ({ ...current, [field]: value }));
    setProductFormErrors((current) => {
      if (!current[field] && !current.form) return current;
      const next = { ...current };
      delete next[field];
      delete next.form;
      return next;
    });
  }

  async function createProduct(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!currentGrid || dirtyCount > 0) return;

    const { errors, values } = validateProductForm(productForm);
    if (Object.keys(errors).length > 0) {
      setProductFormErrors(errors);
      return;
    }

    const body: {
      category: string;
      productName: string;
      productMaker: string | null;
      spec: string | null;
      vendorPrice?: {
        vendorName: string;
        unitPrice: number;
        priceUpdatedOn: string | null;
      };
    } = {
      category: currentGrid.category,
      productName: values.productName,
      productMaker: values.productMaker,
      spec: values.spec,
    };

    if (values.hasVendorPrice && values.unitPrice !== null) {
      body.vendorPrice = {
        vendorName: values.vendorName,
        unitPrice: values.unitPrice,
        priceUpdatedOn: values.priceUpdatedOn,
      };
    }

    setIsCreatingProduct(true);
    setProductFormErrors({});
    setErrorMessage(null);
    setSuccessMessage(null);

    try {
      const response = await fetch("/api/records/products", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });

      if (!response.ok) {
        const problem = (await response.json().catch(() => null)) as ApiErrorResponse | null;
        setProductFormErrors({ form: getCreateProductErrorMessage(response.status, problem) });
        return;
      }

      setIsProductFormOpen(false);
      setProductForm(initialProductForm);
      setProductFormErrors({});
      setSuccessMessage("商品を追加しました。シートを更新しています。");
      router.refresh();
    } catch (error) {
      console.error("[records:sheets] product creation failed", error);
      setProductFormErrors({ form: "登録に失敗しました。時間をおいて再度お試しください。" });
    } finally {
      setIsCreatingProduct(false);
    }
  }

  async function saveChanges() {
    if (!currentGrid || dirtyPayload.length === 0 || dirtyCount === 0) return;
    if (hasInvalidDirtyPrice) {
      setErrorMessage("仕切りは0以上999999999以下の数値で入力してください。");
      return;
    }
    if (!window.confirm(`${dirtyCount}件のセル変更を保存します。よろしいですか？`)) return;

    setIsSaving(true);
    setErrorMessage(null);
    setSuccessMessage(null);

    try {
      const response = await fetch(
        `/api/records/sheets/${encodeURIComponent(currentGrid.category)}/cells`,
        {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ cells: dirtyPayload }),
        },
      );

      if (!response.ok) {
        const problem = (await response.json().catch(() => null)) as ProblemResponse | null;
        setErrorMessage(getProblemMessage(problem ?? { status: response.status }));
        return;
      }

      const result = (await response.json()) as {
        ok: true;
        changedCount: number;
        grid: ProductSheetGrid;
      };
      setCurrentGrid(result.grid);
      setDraftValues({});
      setDirtyFields(new Set());
      setSuccessMessage(
        result.changedCount === 0
          ? "保存対象の実変更はありませんでした。"
          : `${result.changedCount.toLocaleString("ja-JP")}件の変更を保存しました。`,
      );
    } catch (error) {
      console.error("[records:sheets] save failed", error);
      setErrorMessage("保存に失敗しました。時間をおいて再度お試しください。");
    } finally {
      setIsSaving(false);
    }
  }

  return (
    <>
      <header className={styles.header}>
        <div className={styles.headerText}>
          <h1>{currentGrid ? currentGrid.category : "Excel風表示"}</h1>
          <p>
            {currentGrid
              ? `${currentGrid.rows.length.toLocaleString("ja-JP")} 商品 / ${currentGrid.vendors.length.toLocaleString(
                  "ja-JP",
                )} 業者のシートです。仕切りと最終更新日をセル単位で編集できます。`
              : "カテゴリをシートのように切り替えて、業者別仕切りを横展開で確認します。"}
          </p>
        </div>
        <div className={styles.actions}>
          <Link href="/records/sheets/new" className={styles.primaryButton}>
            シート追加
          </Link>
          <Link href="/records" className={styles.secondaryLink}>
            仕切り表へ戻る
          </Link>
        </div>
      </header>

      {categories.length === 0 || !currentGrid ? (
        <p className={styles.emptyState}>表示できるカテゴリがまだありません。</p>
      ) : (
        <>
          <div className={styles.editToolbar}>
            <p className={styles.meta}>未保存の変更 {dirtyCount.toLocaleString("ja-JP")}件</p>
            <div className={styles.editActions}>
              <button
                type="button"
                className={styles.secondaryButton}
                onClick={openProductForm}
                disabled={dirtyCount > 0 || isSaving || isCreatingProduct}
                title={
                  dirtyCount > 0 ? "未保存の変更を保存または破棄してから追加できます。" : undefined
                }
              >
                商品追加
              </button>
              <button
                type="button"
                className={styles.secondaryButton}
                onClick={discardChanges}
                disabled={dirtyCount === 0 || isSaving}
              >
                変更を破棄
              </button>
              <button
                type="button"
                className={styles.primaryButton}
                onClick={saveChanges}
                disabled={dirtyCount === 0 || isSaving || hasInvalidDirtyPrice}
              >
                {isSaving ? "保存中..." : "保存"}
              </button>
            </div>
          </div>
          {dirtyCount > 0 && (
            <p className={styles.meta}>
              商品追加は、未保存のセル変更を保存または破棄すると利用できます。
            </p>
          )}
          {isProductFormOpen && (
            <div className={styles.modalOverlay} role="presentation">
              <section
                className={styles.productDialog}
                role="dialog"
                aria-modal="true"
                aria-labelledby="add-product-title"
              >
                <div className={styles.productDialogHeader}>
                  <div>
                    <h2 id="add-product-title">商品追加</h2>
                    <p>{currentGrid.category} に1件ずつ商品を追加します。</p>
                  </div>
                  <button
                    type="button"
                    className={styles.iconButton}
                    onClick={closeProductForm}
                    disabled={isCreatingProduct}
                    aria-label="商品追加フォームを閉じる"
                  >
                    ×
                  </button>
                </div>
                <form className={styles.productForm} onSubmit={createProduct} noValidate>
                  {productFormErrors.form && (
                    <p className={styles.errorMessage}>{productFormErrors.form}</p>
                  )}
                  <div className={styles.formGrid}>
                    <label className={styles.formField}>
                      <span>
                        品名 <strong aria-hidden="true">*</strong>
                      </span>
                      <input
                        type="text"
                        value={productForm.productName}
                        maxLength={300}
                        required
                        aria-invalid={Boolean(productFormErrors.productName)}
                        aria-describedby={
                          productFormErrors.productName ? "product-name-error" : undefined
                        }
                        onChange={(event) =>
                          updateProductFormField("productName", event.target.value)
                        }
                      />
                      {productFormErrors.productName && (
                        <small id="product-name-error" className={styles.fieldError}>
                          {productFormErrors.productName}
                        </small>
                      )}
                    </label>
                    <label className={styles.formField}>
                      <span>メーカー</span>
                      <input
                        type="text"
                        value={productForm.productMaker}
                        maxLength={200}
                        aria-invalid={Boolean(productFormErrors.productMaker)}
                        onChange={(event) =>
                          updateProductFormField("productMaker", event.target.value)
                        }
                      />
                      {productFormErrors.productMaker && (
                        <small className={styles.fieldError}>
                          {productFormErrors.productMaker}
                        </small>
                      )}
                    </label>
                    <label className={styles.formField}>
                      <span>規格</span>
                      <input
                        type="text"
                        value={productForm.spec}
                        maxLength={300}
                        aria-invalid={Boolean(productFormErrors.spec)}
                        onChange={(event) => updateProductFormField("spec", event.target.value)}
                      />
                      {productFormErrors.spec && (
                        <small className={styles.fieldError}>{productFormErrors.spec}</small>
                      )}
                    </label>
                  </div>
                  <fieldset className={styles.vendorFieldset}>
                    <legend>初期業者価格（任意）</legend>
                    <div className={styles.formGrid}>
                      <label className={styles.formField}>
                        <span>業者名</span>
                        <input
                          type="text"
                          value={productForm.vendorName}
                          maxLength={200}
                          aria-invalid={Boolean(productFormErrors.vendorName)}
                          onChange={(event) =>
                            updateProductFormField("vendorName", event.target.value)
                          }
                        />
                        {productFormErrors.vendorName && (
                          <small className={styles.fieldError}>
                            {productFormErrors.vendorName}
                          </small>
                        )}
                      </label>
                      <label className={styles.formField}>
                        <span>仕切り</span>
                        <input
                          type="number"
                          min="0"
                          max="999999999"
                          step="0.01"
                          inputMode="decimal"
                          value={productForm.unitPrice}
                          aria-invalid={Boolean(productFormErrors.unitPrice)}
                          onChange={(event) =>
                            updateProductFormField("unitPrice", event.target.value)
                          }
                        />
                        {productFormErrors.unitPrice && (
                          <small className={styles.fieldError}>{productFormErrors.unitPrice}</small>
                        )}
                      </label>
                      <label className={styles.formField}>
                        <span>最終更新日</span>
                        <input
                          type="date"
                          value={productForm.priceUpdatedOn}
                          aria-invalid={Boolean(productFormErrors.priceUpdatedOn)}
                          onChange={(event) =>
                            updateProductFormField("priceUpdatedOn", event.target.value)
                          }
                        />
                        {productFormErrors.priceUpdatedOn && (
                          <small className={styles.fieldError}>
                            {productFormErrors.priceUpdatedOn}
                          </small>
                        )}
                      </label>
                    </div>
                  </fieldset>
                  <div className={styles.formActions}>
                    <button
                      type="button"
                      className={styles.secondaryButton}
                      onClick={closeProductForm}
                      disabled={isCreatingProduct}
                    >
                      キャンセル
                    </button>
                    <button
                      type="submit"
                      className={styles.primaryButton}
                      disabled={isCreatingProduct}
                    >
                      {isCreatingProduct ? "登録中..." : "登録"}
                    </button>
                  </div>
                </form>
              </section>
            </div>
          )}
          {hasInvalidDirtyPrice && (
            <p className={styles.errorMessage}>
              仕切りは0以上999999999以下の数値で入力してください。
            </p>
          )}
          {errorMessage && <p className={styles.errorMessage}>{errorMessage}</p>}
          {successMessage && <p className={styles.successMessage}>{successMessage}</p>}
          {currentGrid.rows.length === 0 ? (
            <p className={styles.emptyState}>このカテゴリの商品は見つかりませんでした。</p>
          ) : (
            <>
              <div
                ref={topScrollRef}
                className={styles.topScrollBar}
                data-visible={hasHorizontalOverflow}
                role="region"
                aria-label="横スクロール"
                tabIndex={0}
                onScroll={syncFromTop}
              >
                <div ref={topSpacerRef} className={styles.topScrollSpacer} />
              </div>
              <div
                ref={tableScrollRef}
                className={styles.gridWrap}
                role="region"
                aria-label={`${currentGrid.category}の仕切り表`}
                onScroll={syncFromTable}
              >
                <table className={styles.sheetTable}>
                  <thead>
                    <tr>
                      <th className={styles.stickyName} scope="col">
                        品名
                      </th>
                      <th className={styles.stickyMaker} scope="col">
                        メーカー
                      </th>
                      <th className={styles.stickySpec} scope="col">
                        規格
                      </th>
                      {currentGrid.vendors.map((vendor) => (
                        <Fragment key={vendor.vendorName}>
                          <th scope="col">{vendor.vendorName} 最終更新日</th>
                          <th scope="col">{vendor.vendorName} 仕切り</th>
                        </Fragment>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {currentGrid.rows.map((row) => (
                      <tr key={row.productId}>
                        <td className={styles.stickyName}>{row.productName}</td>
                        <td className={styles.stickyMaker}>{row.productMaker ?? "-"}</td>
                        <td className={styles.stickySpec}>{row.spec ?? "-"}</td>
                        {currentGrid.vendors.map((vendor) => {
                          const price = row.prices[vendor.vendorName];
                          if (!price) {
                            return (
                              <Fragment key={`${row.productId}-${vendor.vendorName}`}>
                                <td>-</td>
                                <td className={styles.priceCell}>-</td>
                              </Fragment>
                            );
                          }

                          const priceUpdatedOnKey = getDirtyKey(
                            price.vendorPriceId,
                            "priceUpdatedOn",
                          );
                          const unitPriceKey = getDirtyKey(price.vendorPriceId, "unitPrice");
                          const originalDate = toDateInputValue(price.priceUpdatedOn);
                          const originalPrice = toPriceInputValue(price.unitPrice);
                          const dateValue = draftValues[priceUpdatedOnKey] ?? originalDate;
                          const priceValue = draftValues[unitPriceKey] ?? originalPrice;
                          const isDateDirty = dirtyFields.has(priceUpdatedOnKey);
                          const isPriceDirty = dirtyFields.has(unitPriceKey);
                          const isPriceInvalid =
                            isPriceDirty &&
                            (normalizePrice(priceValue) === null || Number(priceValue) > 999999999);

                          return (
                            <Fragment key={`${row.productId}-${vendor.vendorName}`}>
                              <td className={isDateDirty ? styles.dirtyCell : undefined}>
                                <input
                                  type="date"
                                  className={styles.cellInput}
                                  value={dateValue}
                                  aria-label={`${row.productName} ${vendor.vendorName} 最終更新日`}
                                  onChange={(event: ChangeEvent<HTMLInputElement>) =>
                                    updateDraft(
                                      price.vendorPriceId,
                                      "priceUpdatedOn",
                                      event.target.value,
                                      originalDate,
                                    )
                                  }
                                />
                              </td>
                              <td
                                className={`${styles.priceCell} ${isPriceDirty ? styles.dirtyCell : ""} ${
                                  isPriceInvalid ? styles.invalidCell : ""
                                }`}
                              >
                                <input
                                  type="text"
                                  inputMode="decimal"
                                  className={`${styles.cellInput} ${styles.priceInput}`}
                                  value={priceValue}
                                  aria-label={`${row.productName} ${vendor.vendorName} 仕切り`}
                                  onChange={(event: ChangeEvent<HTMLInputElement>) =>
                                    updateDraft(
                                      price.vendorPriceId,
                                      "unitPrice",
                                      event.target.value,
                                      originalPrice,
                                    )
                                  }
                                />
                                <span className={styles.formattedValue}>
                                  {formatPrice(price.unitPrice)}
                                </span>
                              </td>
                            </Fragment>
                          );
                        })}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </>
      )}

      {categories.length > 0 && (
        <nav className={styles.sheetTabs} aria-label="カテゴリシート切り替え">
          {categories.map((item, index) => {
            const active = item.category === currentGrid?.category;
            return (
              <Link
                key={item.category}
                href={getSheetHref(item.category, index)}
                scroll={false}
                className={`${styles.sheetTab} ${active ? styles.sheetTabActive : ""}`}
                aria-current={active ? "page" : undefined}
                aria-label={`${item.category}（${item.productCount.toLocaleString("ja-JP")}商品）`}
                title={`${item.category}（${item.productCount.toLocaleString("ja-JP")}商品）`}
              >
                <span>{item.category}</span>
              </Link>
            );
          })}
        </nav>
      )}
    </>
  );
}
