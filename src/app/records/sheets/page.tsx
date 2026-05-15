import Link from "next/link";
import SharedNavHeader from "@/app/shared-nav-header";
import { listProductSheetCategories } from "@/services/records/sheets";
import styles from "./sheets.module.css";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

export default async function ProductSheetsPage() {
  const categories = await listProductSheetCategories();

  return (
    <>
      <SharedNavHeader />
      <main className={styles.page}>
        <header className={styles.header}>
          <div className={styles.headerText}>
            <h1>Excel風表示</h1>
            <p>カテゴリをシートのように切り替えて、業者別仕切りを横展開で確認します。</p>
          </div>
          <div className={styles.actions}>
            <Link href="/records" className={styles.secondaryLink}>
              仕切り表へ戻る
            </Link>
          </div>
        </header>

        {categories.length === 0 ? (
          <p className={styles.emptyState}>表示できるカテゴリがまだありません。</p>
        ) : (
          <section className={styles.categoryGrid} aria-label="カテゴリ一覧">
            {categories.map((item) => (
              <Link
                key={item.category}
                href={`/records/sheets/${encodeURIComponent(item.category)}`}
                className={styles.categoryCard}
              >
                <strong>{item.category}</strong>
                <span className={styles.categoryStats}>
                  <span>{item.productCount.toLocaleString("ja-JP")} 商品</span>
                  <span>{item.vendorCount.toLocaleString("ja-JP")} 業者</span>
                </span>
                <span className={styles.linkButton}>シートを開く</span>
              </Link>
            ))}
          </section>
        )}
      </main>
    </>
  );
}
