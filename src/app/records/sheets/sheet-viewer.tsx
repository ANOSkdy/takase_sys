import Link from "next/link";
import { Fragment } from "react";
import type { ProductSheetCategory, ProductSheetGrid } from "@/services/records/sheets";
import styles from "./sheets.module.css";

const numberFormat = new Intl.NumberFormat("ja-JP");

function formatDate(value: string | Date | null | undefined) {
  if (!value) return "-";
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) return trimmed.replaceAll("-", "/");
    const parsed = new Date(trimmed);
    if (Number.isNaN(parsed.getTime())) return "-";
    return parsed.toISOString().slice(0, 10).replaceAll("-", "/");
  }
  return value.toISOString().slice(0, 10).replaceAll("-", "/");
}

function formatPrice(value: string | number | null | undefined) {
  if (value == null) return "-";
  const numeric = Number(value);
  if (Number.isNaN(numeric)) return String(value);
  return numberFormat.format(numeric);
}

function getSheetHref(category: string, index: number) {
  if (index === 0) return "/records/sheets";
  return `/records/sheets/${encodeURIComponent(category)}`;
}

export default function ProductSheetViewer({
  categories,
  grid,
}: {
  categories: ProductSheetCategory[];
  grid: ProductSheetGrid | null;
}) {
  return (
    <>
      <header className={styles.header}>
        <div className={styles.headerText}>
          <h1>{grid ? grid.category : "Excel風表示"}</h1>
          <p>
            {grid
              ? `${grid.rows.length.toLocaleString("ja-JP")} 商品 / ${grid.vendors.length.toLocaleString(
                  "ja-JP",
                )} 業者の読み取り専用シートです。`
              : "カテゴリをシートのように切り替えて、業者別仕切りを横展開で確認します。"}
          </p>
        </div>
        <div className={styles.actions}>
          <Link href="/records" className={styles.secondaryLink}>
            仕切り表へ戻る
          </Link>
        </div>
      </header>

      {categories.length === 0 || !grid ? (
        <p className={styles.emptyState}>表示できるカテゴリがまだありません。</p>
      ) : grid.rows.length === 0 ? (
        <p className={styles.emptyState}>このカテゴリの商品は見つかりませんでした。</p>
      ) : (
        <>
          <p className={styles.meta}>セル編集・行追加・保存はPR2で追加予定です。</p>
          <div className={styles.gridWrap} role="region" aria-label={`${grid.category}の仕切り表`}>
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
                  {grid.vendors.map((vendor) => (
                    <Fragment key={vendor.vendorName}>
                      <th scope="col">{vendor.vendorName} 最終更新日</th>
                      <th scope="col">{vendor.vendorName} 仕切り</th>
                    </Fragment>
                  ))}
                </tr>
              </thead>
              <tbody>
                {grid.rows.map((row) => (
                  <tr key={row.productId}>
                    <td className={styles.stickyName}>{row.productName}</td>
                    <td className={styles.stickyMaker}>{row.productMaker ?? "-"}</td>
                    <td className={styles.stickySpec}>{row.spec ?? "-"}</td>
                    {grid.vendors.map((vendor) => {
                      const price = row.prices[vendor.vendorName];
                      return (
                        <Fragment key={`${row.productId}-${vendor.vendorName}`}>
                          <td>{formatDate(price?.priceUpdatedOn ?? price?.updatedAt)}</td>
                          <td className={styles.priceCell}>{formatPrice(price?.unitPrice)}</td>
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
            const active = item.category === grid?.category;
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
