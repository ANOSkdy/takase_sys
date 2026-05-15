import Link from "next/link";
import React from "react";
import { notFound } from "next/navigation";
import { z } from "zod";
import SharedNavHeader from "@/app/shared-nav-header";
import { getProductSheetGrid } from "@/services/records/sheets";
import styles from "../sheets.module.css";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

const categoryParamSchema = z.object({
  category: z.string().trim().min(1).max(200),
});

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

export default async function ProductSheetCategoryPage({
  params,
}: {
  params: Promise<{ category: string }>;
}) {
  const parsed = categoryParamSchema.safeParse(await params);
  if (!parsed.success) notFound();

  const grid = await getProductSheetGrid(parsed.data.category);

  return (
    <>
      <SharedNavHeader />
      <main className={styles.page}>
        <header className={styles.header}>
          <div className={styles.headerText}>
            <h1>{grid.category}</h1>
            <p>
              {grid.rows.length.toLocaleString("ja-JP")} 商品 /{" "}
              {grid.vendors.length.toLocaleString("ja-JP")} 業者の読み取り専用シートです。
            </p>
          </div>
          <div className={styles.actions}>
            <Link href="/records/sheets" className={styles.secondaryLink}>
              カテゴリ一覧へ戻る
            </Link>
            <Link href="/records" className={styles.secondaryLink}>
              仕切り表へ戻る
            </Link>
          </div>
        </header>

        {grid.rows.length === 0 ? (
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
                      <React.Fragment key={vendor.vendorName}>
                        <th scope="col">{vendor.vendorName} 最終更新日</th>
                        <th scope="col">{vendor.vendorName} 仕切り</th>
                      </React.Fragment>
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
                          <React.Fragment key={`${row.productId}-${vendor.vendorName}`}>
                            <td>{formatDate(price?.priceUpdatedOn ?? price?.updatedAt)}</td>
                            <td className={styles.priceCell}>{formatPrice(price?.unitPrice)}</td>
                          </React.Fragment>
                        );
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
      </main>
    </>
  );
}
