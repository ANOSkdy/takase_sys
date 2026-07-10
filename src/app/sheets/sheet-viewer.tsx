"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useRouter } from "next/navigation";
import { Fragment, useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import type { ProductSheetCategory, ProductSheetGrid } from "@/services/records/sheets";
import styles from "./sheets.module.css";

const numberFormat = new Intl.NumberFormat("ja-JP");
const dateRegex = /^\d{4}-\d{2}-\d{2}$/;

type ProblemResponse = {
  status?: number;
};
type ProductFormState = {
  productName: string;
  productMaker: string;
  category: string;
  spec: string;
  vendorName: string;
  unitPrice: string;
  priceUpdatedOn: string;
};
type ProductFormErrors = Partial<Record<keyof ProductFormState | "form", string>>;

type VendorPriceModalMode = "create" | "edit";
type VendorPriceModalState = {
  mode: VendorPriceModalMode;
  productId: string;
  productName: string;
  spec: string | null;
  vendorName: string;
  vendorPriceId: string | null;
  unitPrice: string | number | null;
  priceUpdatedOn: string | Date | null;
};
type VendorPriceFormState = {
  unitPrice: string;
  priceUpdatedOn: string;
};
type VendorPriceFormErrors = Partial<Record<keyof VendorPriceFormState | "form", string>>;
type VendorPriceHistoryItem = {
  updatedAt: string;
  beforeValue: string | null;
  afterValue: string | null;
  sourceType: string | null;
  updatedBy: string | null;
};
type VendorPriceHistoryState = {
  status: "idle" | "loading" | "success" | "error";
  items: VendorPriceHistoryItem[];
};

type ApiErrorResponse = {
  error?: {
    code?: string;
    message?: string;
  };
};

const initialProductForm: ProductFormState = {
  productName: "",
  productMaker: "",
  category: "",
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

function formatHistoryValue(value: string | null | undefined) {
  if (!value) return "未登録";
  return formatPrice(value);
}

function formatHistoryDate(value: string) {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return value;
  return new Intl.DateTimeFormat("ja-JP", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(parsed);
}

function getSheetHref(category: string | null, searchParams: URLSearchParams) {
  const params = new URLSearchParams(searchParams);
  params.delete("page");
  if (category === null) params.delete("category");
  else params.set("category", category);
  for (const key of Array.from(params.keys())) {
    if (!params.get(key)?.trim()) params.delete(key);
  }
  const query = params.toString();
  return query ? `/sheets?${query}` : "/sheets";
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

function getVendorPriceErrorMessage(status: number, problem: ApiErrorResponse | null) {
  if (status === 400) return "入力内容を確認してください。";
  if (status === 404) return "対象の商品が見つかりません。画面を更新して再度お試しください。";
  if (status === 409 && problem?.error?.code === "VENDOR_PRICE_ALREADY_EXISTS") {
    return "この業者価格は既に登録されています。画面を更新して再度お試しください。";
  }
  return "保存に失敗しました。時間をおいて再度お試しください。";
}

function validateVendorPriceForm(form: VendorPriceFormState) {
  const errors: VendorPriceFormErrors = {};
  const unitPriceText = form.unitPrice.trim();
  const priceUpdatedOn = form.priceUpdatedOn.trim();

  if (!unitPriceText) {
    errors.unitPrice = "仕切りを入力してください。";
  } else {
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
      unitPrice: unitPriceText ? Number(unitPriceText) : null,
      priceUpdatedOn: priceUpdatedOn || null,
    },
  };
}

function validateProductForm(form: ProductFormState) {
  const errors: ProductFormErrors = {};
  const productName = form.productName.trim();
  const productMaker = form.productMaker.trim();
  const category = form.category.trim();
  const spec = form.spec.trim();
  const vendorName = form.vendorName.trim();
  const unitPriceText = form.unitPrice.trim();
  const priceUpdatedOn = form.priceUpdatedOn.trim();

  if (!productName) errors.productName = "品名を入力してください。";
  if (productName.length > 300) errors.productName = "品名は300文字以内で入力してください。";
  if (productMaker.length > 200) errors.productMaker = "メーカーは200文字以内で入力してください。";
  if (!category) errors.category = "カテゴリを入力してください。";
  if (category.length > 200) errors.category = "カテゴリは200文字以内で入力してください。";
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
      category,
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
  const searchParams = useSearchParams();
  const [currentGrid, setCurrentGrid] = useState(grid);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [isSavingVendorPrice, setIsSavingVendorPrice] = useState(false);
  const [isProductFormOpen, setIsProductFormOpen] = useState(false);
  const [isCreatingProduct, setIsCreatingProduct] = useState(false);
  const [productForm, setProductForm] = useState<ProductFormState>(initialProductForm);
  const [productFormErrors, setProductFormErrors] = useState<ProductFormErrors>({});
  const [vendorPriceModal, setVendorPriceModal] = useState<VendorPriceModalState | null>(null);
  const [vendorPriceForm, setVendorPriceForm] = useState<VendorPriceFormState>({
    unitPrice: "",
    priceUpdatedOn: "",
  });
  const [vendorPriceFormErrors, setVendorPriceFormErrors] = useState<VendorPriceFormErrors>({});
  const [vendorPriceHistory, setVendorPriceHistory] = useState<VendorPriceHistoryState>({
    status: "idle",
    items: [],
  });
  const [visibleVendorNames, setVisibleVendorNames] = useState<Set<string>>(
    () => new Set(grid?.vendors.map((vendor) => vendor.vendorName) ?? []),
  );
  const [isVendorPanelOpen, setIsVendorPanelOpen] = useState(false);
  const [jumpedVendorName, setJumpedVendorName] = useState<string | null>(null);
  const [hasHorizontalOverflow, setHasHorizontalOverflow] = useState(false);
  const topScrollRef = useRef<HTMLDivElement>(null);
  const tableScrollRef = useRef<HTMLDivElement>(null);
  const topSpacerRef = useRef<HTMLDivElement>(null);
  const vendorHeaderRefs = useRef(new Map<string, HTMLTableCellElement>());
  const jumpHighlightTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const syncSourceRef = useRef<"top" | "table" | null>(null);
  const activeTabRef = useRef<HTMLAnchorElement>(null);

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

  const visibleVendors = useMemo(() => {
    if (!currentGrid) return [];
    return currentGrid.vendors.filter((vendor) => visibleVendorNames.has(vendor.vendorName));
  }, [currentGrid, visibleVendorNames]);

  useEffect(() => {
    setCurrentGrid(grid);
    setVisibleVendorNames(new Set(grid?.vendors.map((vendor) => vendor.vendorName) ?? []));
    setIsVendorPanelOpen(false);
    setJumpedVendorName(null);
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
  }, [currentGrid, visibleVendors, updateTopScrollbar]);

  useEffect(() => {
    if (!vendorPriceModal || vendorPriceModal.mode !== "edit") {
      setVendorPriceHistory({ status: "idle", items: [] });
      return;
    }

    const controller = new AbortController();
    setVendorPriceHistory({ status: "loading", items: [] });

    const params = new URLSearchParams({ vendorName: vendorPriceModal.vendorName });
    fetch(
      `/api/records/products/${encodeURIComponent(
        vendorPriceModal.productId,
      )}/vendor-prices/history?${params.toString()}`,
      { signal: controller.signal },
    )
      .then(async (response) => {
        if (!response.ok) throw new Error("history request failed");
        return (await response.json()) as { items: VendorPriceHistoryItem[] };
      })
      .then((data) => {
        setVendorPriceHistory({ status: "success", items: data.items });
      })
      .catch((error) => {
        if (error instanceof DOMException && error.name === "AbortError") return;
        setVendorPriceHistory({ status: "error", items: [] });
      });

    return () => controller.abort();
  }, [vendorPriceModal]);

  useEffect(() => {
    activeTabRef.current?.scrollIntoView({ block: "nearest", inline: "nearest" });
  }, [currentGrid?.category]);

  useEffect(() => {
    return () => {
      if (jumpHighlightTimeoutRef.current) clearTimeout(jumpHighlightTimeoutRef.current);
    };
  }, []);

  function toggleVendorVisibility(vendorName: string) {
    setVisibleVendorNames((current) => {
      const next = new Set(current);
      if (next.has(vendorName)) {
        if (next.size <= 1) return current;
        next.delete(vendorName);
      } else {
        next.add(vendorName);
      }
      return next;
    });
  }

  function showAllVendors() {
    if (!currentGrid) return;
    setVisibleVendorNames(new Set(currentGrid.vendors.map((vendor) => vendor.vendorName)));
  }

  function jumpToVendor(vendorName: string) {
    const tableScroll = tableScrollRef.current;
    const header = vendorHeaderRefs.current.get(vendorName);
    if (!tableScroll || !header) return;

    const targetLeft = Math.max(header.offsetLeft - 12, 0);
    tableScroll.scrollTo({ left: targetLeft, behavior: "smooth" });
    if (topScrollRef.current) topScrollRef.current.scrollLeft = targetLeft;
    setJumpedVendorName(vendorName);
    if (jumpHighlightTimeoutRef.current) clearTimeout(jumpHighlightTimeoutRef.current);
    jumpHighlightTimeoutRef.current = setTimeout(() => setJumpedVendorName(null), 1400);
  }

  function openProductForm() {
    setProductFormErrors({});
    setProductForm({ ...initialProductForm, category: currentGrid?.category ?? "" });
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
    if (!currentGrid) return;

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
      category: values.category,
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
      console.error("[sheets] product creation failed", error);
      setProductFormErrors({ form: "登録に失敗しました。時間をおいて再度お試しください。" });
    } finally {
      setIsCreatingProduct(false);
    }
  }

  function openVendorPriceModal(
    row: ProductSheetGrid["rows"][number],
    vendorName: string,
    price: ProductSheetGrid["rows"][number]["prices"][string] | undefined,
  ) {
    if (!vendorName.trim()) {
      setErrorMessage("業者名を確認できないため、価格を登録できません。画面を更新してください。");
      return;
    }

    setVendorPriceModal({
      mode: price ? "edit" : "create",
      productId: row.productId,
      productName: row.productName,
      spec: row.spec,
      vendorName,
      vendorPriceId: price?.vendorPriceId ?? null,
      unitPrice: price?.unitPrice ?? null,
      priceUpdatedOn: price?.priceUpdatedOn ?? null,
    });
    setVendorPriceForm({
      unitPrice: price ? String(price.unitPrice) : "",
      priceUpdatedOn: toDateInputValue(price?.priceUpdatedOn),
    });
    setVendorPriceFormErrors({});
    setVendorPriceHistory({ status: price ? "loading" : "idle", items: [] });
    setErrorMessage(null);
    setSuccessMessage(null);
  }

  function closeVendorPriceModal() {
    if (isSavingVendorPrice) return;
    setVendorPriceModal(null);
    setVendorPriceForm({ unitPrice: "", priceUpdatedOn: "" });
    setVendorPriceFormErrors({});
    setVendorPriceHistory({ status: "idle", items: [] });
  }

  function updateVendorPriceFormField(field: keyof VendorPriceFormState, value: string) {
    setVendorPriceForm((current) => ({ ...current, [field]: value }));
    setVendorPriceFormErrors((current) => {
      if (!current[field] && !current.form) return current;
      const next = { ...current };
      delete next[field];
      delete next.form;
      return next;
    });
  }

  async function saveVendorPrice(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!currentGrid || !vendorPriceModal || isSavingVendorPrice) return;

    const { errors, values } = validateVendorPriceForm(vendorPriceForm);
    if (Object.keys(errors).length > 0 || values.unitPrice === null) {
      setVendorPriceFormErrors(errors);
      return;
    }

    setIsSavingVendorPrice(true);
    setVendorPriceFormErrors({});
    setErrorMessage(null);
    setSuccessMessage(null);

    try {
      if (vendorPriceModal.mode === "create") {
        const response = await fetch(
          `/api/records/products/${encodeURIComponent(vendorPriceModal.productId)}/vendor-prices`,
          {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({
              vendorName: vendorPriceModal.vendorName,
              unitPrice: values.unitPrice,
              priceUpdatedOn: values.priceUpdatedOn,
            }),
          },
        );

        if (!response.ok) {
          const problem = (await response.json().catch(() => null)) as ApiErrorResponse | null;
          setVendorPriceFormErrors({
            form: getVendorPriceErrorMessage(response.status, problem),
          });
          return;
        }

        setVendorPriceModal(null);
        setVendorPriceForm({ unitPrice: "", priceUpdatedOn: "" });
        setVendorPriceFormErrors({});
        setSuccessMessage("業者価格を登録しました。シートを更新しています。");
        router.refresh();
        return;
      }

      if (!vendorPriceModal.vendorPriceId) {
        setVendorPriceFormErrors({
          form: "業者価格のIDを確認できません。画面を更新して再度お試しください。",
        });
        return;
      }

      const response = await fetch("/api/sheets/cells", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          cells: [
            {
              vendorPriceId: vendorPriceModal.vendorPriceId,
              unitPrice: values.unitPrice,
              priceUpdatedOn: values.priceUpdatedOn,
            },
          ],
        }),
      });

      if (!response.ok) {
        const problem = (await response.json().catch(() => null)) as ProblemResponse | null;
        setVendorPriceFormErrors({
          form: getProblemMessage(problem ?? { status: response.status }),
        });
        return;
      }

      const result = (await response.json()) as {
        ok: true;
        changedCount: number;
        grid: ProductSheetGrid;
      };
      setCurrentGrid(result.grid);
      setVendorPriceModal(null);
      setVendorPriceForm({ unitPrice: "", priceUpdatedOn: "" });
      setVendorPriceFormErrors({});
      setSuccessMessage(
        result.changedCount === 0
          ? "保存対象の実変更はありませんでした。"
          : "業者価格を保存しました。シートを更新しています。",
      );
      router.refresh();
    } catch (error) {
      console.error("[sheets] vendor price save failed", error);
      setVendorPriceFormErrors({ form: "保存に失敗しました。時間をおいて再度お試しください。" });
    } finally {
      setIsSavingVendorPrice(false);
    }
  }

  return (
    <>
      <header className={styles.header}>
        <div className={styles.headerText}>
          <h1>{currentGrid?.category ? currentGrid.category : "仕切り表"}</h1>
          <p>
            {currentGrid
              ? `${(currentGrid.totalCount ?? currentGrid.rows.length).toLocaleString("ja-JP")} 商品 / ${visibleVendors.length.toLocaleString("ja-JP")} 業者を表示中`
              : "カテゴリをシートのように切り替えて、業者別仕切りを横展開で確認します。"}
          </p>
        </div>
        <div className={styles.actions}>
          <button
            type="button"
            className={styles.primaryButton}
            onClick={openProductForm}
            disabled={isCreatingProduct}
          >
            商品追加
          </button>
        </div>
      </header>

      {categories.length === 0 || !currentGrid ? (
        <p className={styles.emptyState}>表示できるカテゴリがまだありません。</p>
      ) : (
        <>
          <div className={styles.editToolbar}>
            <div className={styles.sheetControls}>
              <div className={styles.vendorControl}>
                <button
                  type="button"
                  className={styles.secondaryButton}
                  aria-expanded={isVendorPanelOpen}
                  onClick={() => setIsVendorPanelOpen((current) => !current)}
                >
                  表示業者
                </button>
                {isVendorPanelOpen && (
                  <div className={styles.vendorPanel}>
                    <div className={styles.vendorPanelHeader}>
                      <strong>表示業者</strong>
                      <button type="button" className={styles.textButton} onClick={showAllVendors}>
                        すべて表示
                      </button>
                    </div>
                    <div className={styles.vendorCheckboxList}>
                      {currentGrid.vendors.map((vendor) => {
                        const checked = visibleVendorNames.has(vendor.vendorName);
                        return (
                          <label key={vendor.vendorName} className={styles.vendorCheckbox}>
                            <input
                              type="checkbox"
                              checked={checked}
                              disabled={checked && visibleVendorNames.size <= 1}
                              onChange={() => toggleVendorVisibility(vendor.vendorName)}
                            />
                            <span>{vendor.vendorName}</span>
                          </label>
                        );
                      })}
                    </div>
                    <p className={styles.vendorPanelHint}>最後の1業者は非表示にできません。</p>
                  </div>
                )}
              </div>
              <label className={styles.jumpField}>
                <span>業者へ移動</span>
                <select
                  defaultValue=""
                  aria-label="業者へ移動"
                  onChange={(event) => {
                    const vendorName = event.target.value;
                    if (vendorName) jumpToVendor(vendorName);
                    event.target.value = "";
                  }}
                >
                  <option value="">業者を選択</option>
                  {visibleVendors.map((vendor) => (
                    <option key={vendor.vendorName} value={vendor.vendorName}>
                      {vendor.vendorName}
                    </option>
                  ))}
                </select>
              </label>
            </div>
          </div>
          <details className={styles.secondaryPanel}>
            <summary>検索・表示条件</summary>
            <div className={styles.secondaryPanelBody}>
              <p className={styles.meta}>
                価格セルまたは日付セルをクリックして追加・編集できます。表示中:{" "}
                {currentGrid.rows.length.toLocaleString("ja-JP")} /{" "}
                {(currentGrid.totalCount ?? currentGrid.rows.length).toLocaleString("ja-JP")} 商品
              </p>
              <form className={styles.searchForm} action="/sheets">
                {currentGrid?.category ? (
                  <input type="hidden" name="category" value={currentGrid.category} />
                ) : null}
                <label className={styles.searchField}>
                  <span>全体検索</span>
                  <input
                    name="q"
                    type="search"
                    defaultValue={searchParams.get("q") ?? ""}
                    placeholder="品名・規格・業者"
                  />
                </label>
                <label className={styles.searchField}>
                  <span>品名</span>
                  <input name="productName" defaultValue={searchParams.get("productName") ?? ""} />
                </label>
                <label className={styles.searchField}>
                  <span>業者</span>
                  <input name="vendor" defaultValue={searchParams.get("vendor") ?? ""} />
                </label>
                <label className={styles.jumpField}>
                  <span>件数</span>
                  <select name="pageSize" defaultValue={searchParams.get("pageSize") ?? "50"}>
                    <option value="25">25</option>
                    <option value="50">50</option>
                    <option value="100">100</option>
                  </select>
                </label>
                <input type="hidden" name="page" value="1" />
                <button className={styles.primaryButton} type="submit">
                  検索
                </button>
              </form>
              <div className={styles.filterChips} aria-label="適用中の検索条件">
                {[
                  ["q", "全体", searchParams.get("q")],
                  ["productName", "品名", searchParams.get("productName")],
                  ["vendor", "業者", searchParams.get("vendor")],
                ]
                  .filter(([, , value]) => value)
                  .map(([key, label, value]) => {
                    const params = new URLSearchParams(searchParams);
                    params.delete(String(key));
                    params.delete("page");
                    const href = params.toString() ? `/sheets?${params.toString()}` : "/sheets";
                    return (
                      <Link key={String(key)} href={href} className={styles.filterChip}>
                        {label}: {value} <span aria-hidden>×</span>
                      </Link>
                    );
                  })}
              </div>
            </div>
          </details>
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
                    <p>
                      {currentGrid.category
                        ? `${currentGrid.category} に1件ずつ商品を追加します。`
                        : "カテゴリを指定して商品を追加します。"}
                    </p>
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
                      <span>
                        カテゴリ <strong aria-hidden="true">*</strong>
                      </span>
                      <input
                        type="text"
                        value={productForm.category}
                        maxLength={200}
                        required
                        aria-invalid={Boolean(productFormErrors.category)}
                        onChange={(event) => updateProductFormField("category", event.target.value)}
                      />
                      {productFormErrors.category && (
                        <small className={styles.fieldError}>{productFormErrors.category}</small>
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
          {vendorPriceModal && (
            <div className={styles.modalOverlay} role="presentation">
              <section
                className={styles.productDialog}
                role="dialog"
                aria-modal="true"
                aria-labelledby="vendor-price-title"
              >
                <div className={styles.productDialogHeader}>
                  <div>
                    <h2 id="vendor-price-title">
                      {vendorPriceModal.mode === "create" ? "業者価格追加" : "業者価格編集"}
                    </h2>
                    <p>商品と業者を確認して、仕切りと最終更新日を保存します。</p>
                  </div>
                  <button
                    type="button"
                    className={styles.iconButton}
                    onClick={closeVendorPriceModal}
                    disabled={isSavingVendorPrice}
                    aria-label="業者価格フォームを閉じる"
                  >
                    ×
                  </button>
                </div>
                <form className={styles.productForm} onSubmit={saveVendorPrice} noValidate>
                  {vendorPriceFormErrors.form && (
                    <p className={styles.errorMessage}>{vendorPriceFormErrors.form}</p>
                  )}
                  <dl className={styles.contextList}>
                    <div>
                      <dt>商品</dt>
                      <dd>{vendorPriceModal.productName}</dd>
                    </div>
                    <div>
                      <dt>規格</dt>
                      <dd>{vendorPriceModal.spec || "-"}</dd>
                    </div>
                    <div>
                      <dt>業者</dt>
                      <dd>{vendorPriceModal.vendorName}</dd>
                    </div>
                  </dl>
                  <div className={styles.formGrid}>
                    <label className={styles.formField}>
                      <span>
                        仕切り <strong aria-hidden="true">*</strong>
                      </span>
                      <input
                        type="number"
                        min="0"
                        max="999999999"
                        step="0.01"
                        inputMode="decimal"
                        value={vendorPriceForm.unitPrice}
                        required
                        aria-invalid={Boolean(vendorPriceFormErrors.unitPrice)}
                        onChange={(event) =>
                          updateVendorPriceFormField("unitPrice", event.target.value)
                        }
                      />
                      {vendorPriceFormErrors.unitPrice && (
                        <small className={styles.fieldError}>
                          {vendorPriceFormErrors.unitPrice}
                        </small>
                      )}
                    </label>
                    <label className={styles.formField}>
                      <span>最終更新日</span>
                      <input
                        type="date"
                        value={vendorPriceForm.priceUpdatedOn}
                        aria-invalid={Boolean(vendorPriceFormErrors.priceUpdatedOn)}
                        onChange={(event) =>
                          updateVendorPriceFormField("priceUpdatedOn", event.target.value)
                        }
                      />
                      {vendorPriceFormErrors.priceUpdatedOn && (
                        <small className={styles.fieldError}>
                          {vendorPriceFormErrors.priceUpdatedOn}
                        </small>
                      )}
                    </label>
                  </div>
                  <section
                    className={styles.historyBlock}
                    aria-labelledby="vendor-price-history-title"
                  >
                    <h3 id="vendor-price-history-title">最近の変更履歴</h3>
                    {vendorPriceModal.mode === "create" ? (
                      <p>まだ履歴はありません。</p>
                    ) : vendorPriceHistory.status === "loading" ? (
                      <p>履歴を読み込み中...</p>
                    ) : vendorPriceHistory.status === "error" ? (
                      <p>履歴を取得できませんでした。</p>
                    ) : vendorPriceHistory.items.length === 0 ? (
                      <p>変更履歴はありません。</p>
                    ) : (
                      <ul className={styles.historyList}>
                        {vendorPriceHistory.items.map((item) => (
                          <li key={`${item.updatedAt}-${item.beforeValue}-${item.afterValue}`}>
                            <time dateTime={item.updatedAt}>
                              {formatHistoryDate(item.updatedAt)}
                            </time>
                            <span>
                              {formatHistoryValue(item.beforeValue)} →{" "}
                              {formatHistoryValue(item.afterValue)}
                            </span>
                            {item.sourceType && <small>{item.sourceType}</small>}
                          </li>
                        ))}
                      </ul>
                    )}
                  </section>
                  <div className={styles.formActions}>
                    <button
                      type="button"
                      className={styles.secondaryButton}
                      onClick={closeVendorPriceModal}
                      disabled={isSavingVendorPrice}
                    >
                      キャンセル
                    </button>
                    <button
                      type="submit"
                      className={styles.primaryButton}
                      disabled={isSavingVendorPrice}
                    >
                      {isSavingVendorPrice
                        ? "保存中..."
                        : vendorPriceModal.mode === "create"
                          ? "登録"
                          : "保存"}
                    </button>
                  </div>
                </form>
              </section>
            </div>
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
                aria-label={`${currentGrid.category || "全商品"}の仕切り表`}
                onScroll={syncFromTable}
              >
                <table className={styles.sheetTable}>
                  <thead>
                    <tr>
                      <th className={styles.colNo} scope="col" rowSpan={2}>
                        No.
                      </th>
                      <th className={styles.colName} scope="col" rowSpan={2}>
                        品名
                      </th>
                      <th className={styles.colMaker} scope="col" rowSpan={2}>
                        メーカー
                      </th>
                      <th className={styles.colSpec} scope="col" rowSpan={2}>
                        規格
                      </th>
                      {visibleVendors.map((vendor) => (
                        <Fragment key={vendor.vendorName}>
                          <th
                            ref={(element) => {
                              if (element) vendorHeaderRefs.current.set(vendor.vendorName, element);
                              else vendorHeaderRefs.current.delete(vendor.vendorName);
                            }}
                            scope="colgroup"
                            colSpan={2}
                            className={
                              jumpedVendorName === vendor.vendorName
                                ? styles.vendorJumpHighlight
                                : undefined
                            }
                          >
                            {vendor.vendorName}
                          </th>
                        </Fragment>
                      ))}
                    </tr>
                    <tr>
                      {visibleVendors.map((vendor) => (
                        <Fragment key={`${vendor.vendorName}-sub`}>
                          <th scope="col">最終更新日</th>
                          <th scope="col">仕切り</th>
                        </Fragment>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {currentGrid.rows.length === 0 ? (
                      <tr>
                        <td className={styles.noResultCell} colSpan={4 + visibleVendors.length * 2}>
                          条件に一致する商品がありません。
                        </td>
                      </tr>
                    ) : (
                      currentGrid.rows.map((row, rowIndex) => (
                        <tr key={row.productId}>
                          <td className={styles.colNo}>
                            {((currentGrid.page ?? 1) - 1) *
                              (currentGrid.pageSize ?? currentGrid.rows.length) +
                              rowIndex +
                              1}
                          </td>
                          <td className={styles.colName}>{row.productName}</td>
                          <td className={styles.colMaker}>{row.productMaker ?? "-"}</td>
                          <td className={styles.colSpec}>{row.spec ?? "-"}</td>
                          {visibleVendors.map((vendor) => {
                            const price = row.prices[vendor.vendorName];
                            const modalModeLabel = price ? "編集" : "追加";
                            const dateLabel = price
                              ? toDateInputValue(price.priceUpdatedOn) || "-"
                              : "+追加";
                            const priceLabel = price ? formatPrice(price.unitPrice) : "+追加";

                            return (
                              <Fragment key={`${row.productId}-${vendor.vendorName}`}>
                                <td>
                                  <button
                                    type="button"
                                    className={styles.cellButton}
                                    onClick={() =>
                                      openVendorPriceModal(row, vendor.vendorName, price)
                                    }
                                    aria-label={`${row.productName} ${vendor.vendorName} 最終更新日を${modalModeLabel}`}
                                  >
                                    {dateLabel}
                                  </button>
                                </td>
                                <td className={styles.priceCell}>
                                  <button
                                    type="button"
                                    className={`${styles.cellButton} ${styles.priceCellButton}`}
                                    onClick={() =>
                                      openVendorPriceModal(row, vendor.vendorName, price)
                                    }
                                    aria-label={`${row.productName} ${vendor.vendorName} 仕切りを${modalModeLabel}`}
                                  >
                                    {priceLabel}
                                  </button>
                                </td>
                              </Fragment>
                            );
                          })}
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </>
      )}

      {currentGrid?.totalCount !== undefined && currentGrid.page && currentGrid.pageSize ? (
        <nav className={styles.statusBar} aria-label="ページ切り替え">
          <span>
            {currentGrid.totalCount.toLocaleString("ja-JP")}件中{" "}
            {((currentGrid.page - 1) * currentGrid.pageSize + 1).toLocaleString("ja-JP")}〜
            {Math.min(
              currentGrid.page * currentGrid.pageSize,
              currentGrid.totalCount,
            ).toLocaleString("ja-JP")}
            件 / 表示業者 {visibleVendors.length.toLocaleString("ja-JP")}件 /{" "}
            {currentGrid.page.toLocaleString("ja-JP")} /{" "}
            {Math.max(1, Math.ceil(currentGrid.totalCount / currentGrid.pageSize)).toLocaleString(
              "ja-JP",
            )}
            ページ
          </span>
          <span className={styles.statusActions}>
            {currentGrid.page <= 1 ? (
              <button type="button" className={styles.secondaryButton} disabled>
                前へ
              </button>
            ) : (
              <Link
                className={styles.secondaryLink}
                href={(() => {
                  const params = new URLSearchParams(searchParams);
                  params.set("page", String(Math.max(1, currentGrid.page - 1)));
                  return `/sheets?${params.toString()}`;
                })()}
              >
                前へ
              </Link>
            )}
            {currentGrid.page * currentGrid.pageSize >= currentGrid.totalCount ? (
              <button type="button" className={styles.secondaryButton} disabled>
                次へ
              </button>
            ) : (
              <Link
                className={styles.secondaryLink}
                href={(() => {
                  const params = new URLSearchParams(searchParams);
                  params.set("page", String(currentGrid.page + 1));
                  return `/sheets?${params.toString()}`;
                })()}
              >
                次へ
              </Link>
            )}
          </span>
        </nav>
      ) : null}

      {categories.length > 0 && (
        <nav className={styles.sheetTabs} aria-label="カテゴリシート切り替え">
          {[
            {
              category: "全商品",
              productCount: currentGrid?.totalCount ?? 0,
              vendorCount: currentGrid?.vendors.length ?? 0,
            },
            ...categories,
          ].map((item, index) => {
            const isAll = index === 0;
            const active = isAll ? !currentGrid?.category : item.category === currentGrid?.category;
            return (
              <Link
                key={isAll ? "__all" : item.category}
                href={getSheetHref(isAll ? null : item.category, searchParams)}
                scroll={false}
                ref={active ? activeTabRef : undefined}
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
