"use client";

import Link from "next/link";
import { Fragment, useEffect, useMemo, useState, type ChangeEvent } from "react";
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

export default function ProductSheetViewer({
  categories,
  grid,
}: {
  categories: ProductSheetCategory[];
  grid: ProductSheetGrid | null;
}) {
  const [currentGrid, setCurrentGrid] = useState(grid);
  const [draftValues, setDraftValues] = useState<Record<string, string>>({});
  const [dirtyFields, setDirtyFields] = useState<Set<string>>(() => new Set());
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);

  useEffect(() => {
    setCurrentGrid(grid);
    setDraftValues({});
    setDirtyFields(new Set());
    setErrorMessage(null);
    setSuccessMessage(null);
  }, [grid]);

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
          <Link href="/records" className={styles.secondaryLink}>
            仕切り表へ戻る
          </Link>
        </div>
      </header>

      {categories.length === 0 || !currentGrid ? (
        <p className={styles.emptyState}>表示できるカテゴリがまだありません。</p>
      ) : currentGrid.rows.length === 0 ? (
        <p className={styles.emptyState}>このカテゴリの商品は見つかりませんでした。</p>
      ) : (
        <>
          <div className={styles.editToolbar}>
            <p className={styles.meta}>未保存の変更 {dirtyCount.toLocaleString("ja-JP")}件</p>
            <div className={styles.editActions}>
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
          {hasInvalidDirtyPrice && (
            <p className={styles.errorMessage}>仕切りは0以上999999999以下の数値で入力してください。</p>
          )}
          {errorMessage && <p className={styles.errorMessage}>{errorMessage}</p>}
          {successMessage && <p className={styles.successMessage}>{successMessage}</p>}
          <div className={styles.gridWrap} role="region" aria-label={`${currentGrid.category}の仕切り表`}>
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

                      const priceUpdatedOnKey = getDirtyKey(price.vendorPriceId, "priceUpdatedOn");
                      const unitPriceKey = getDirtyKey(price.vendorPriceId, "unitPrice");
                      const originalDate = toDateInputValue(price.priceUpdatedOn);
                      const originalPrice = toPriceInputValue(price.unitPrice);
                      const dateValue = draftValues[priceUpdatedOnKey] ?? originalDate;
                      const priceValue = draftValues[unitPriceKey] ?? originalPrice;
                      const isDateDirty = dirtyFields.has(priceUpdatedOnKey);
                      const isPriceDirty = dirtyFields.has(unitPriceKey);
                      const isPriceInvalid =
                        isPriceDirty && (normalizePrice(priceValue) === null || Number(priceValue) > 999999999);

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
                                updateDraft(price.vendorPriceId, "unitPrice", event.target.value, originalPrice)
                              }
                            />
                            <span className={styles.formattedValue}>{formatPrice(price.unitPrice)}</span>
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
