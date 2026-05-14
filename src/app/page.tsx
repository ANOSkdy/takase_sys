import Link from "next/link";
import SharedNavHeader from "@/app/shared-nav-header";
import {
  getDocumentDashboardStats,
  listPendingDiffReviewItems,
} from "@/services/documents/repository";
import styles from "./page.module.css";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Classification = "NEW_CANDIDATE" | "UNMATCHED";

const navigationCards = [
  {
    href: "/documents",
    title: "納品書アップロード",
    description: "PDF納品書のアップロード、一覧確認、解析実行へ進みます。",
  },
  {
    href: "/products",
    title: "商品マスタ",
    description: "PDF解析や仕切り表から作成された商品情報を確認します。",
  },
  {
    href: "/records",
    title: "レコード検索",
    description: "商品・仕入先・単価の履歴を横断検索します。",
  },
  {
    href: "/documents",
    title: "差分確認",
    description: "納品書ごとの解析結果と商品マスタ更新候補を確認します。",
  },
] as const;

function getClassificationLabel(classification: Classification) {
  switch (classification) {
    case "NEW_CANDIDATE":
      return "新規候補";
    case "UNMATCHED":
      return "未突合";
  }
}

function formatDate(iso: string | null) {
  if (!iso) return "-";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return date.toISOString().slice(0, 10);
}

function getTextField(value: Record<string, unknown>, keys: string[]) {
  for (const key of keys) {
    const field = value[key];
    if (typeof field === "string" && field.trim()) return field;
  }
  return null;
}

export default async function Home() {
  const [stats, pendingItems] = await Promise.all([
    getDocumentDashboardStats(),
    listPendingDiffReviewItems(10),
  ]);

  return (
    <>
      <SharedNavHeader />
      <main className={styles.page}>
        <section className={styles.hero}>
          <div className={styles.heroText}>
            <p className={styles.eyebrow}>PDF納品書解析・商品マスタ管理</p>
            <h1>タカセシステム</h1>
            <p>
              PDF納品書解析、商品マスタ、差分確認への入口です。確認待ちの紐づけがある場合は、ここから各差分へ進めます。
            </p>
          </div>
          <div className={styles.statusGrid} aria-label="システム状況">
            <StatusCard label="アップロード済み" value={stats.uploadedDocuments} unit="件" />
            <StatusCard label="解析失敗" value={stats.failedParses} unit="件" />
            <StatusCard label="確認待ち" value={stats.pendingReview.total} unit="件" accent />
          </div>
        </section>

        <section className={styles.section} aria-labelledby="navigation-heading">
          <div className={styles.sectionHeader}>
            <h2 id="navigation-heading">機能へのナビゲーション</h2>
            <p>よく使う画面へ移動します。</p>
          </div>
          <div className={styles.cardGrid}>
            {navigationCards.map((card) => (
              <Link key={card.title} href={card.href} className={styles.navCard}>
                <span>{card.title}</span>
                <p>{card.description}</p>
              </Link>
            ))}
          </div>
        </section>

        <section className={styles.reviewSection} aria-labelledby="review-heading">
          <div className={styles.sectionHeader}>
            <p className={styles.eyebrow}>紐づけ確認</p>
            <h2 id="review-heading">確認待ちのPDF解析結果</h2>
            <p>NEW_CANDIDATE / UNMATCHED の差分は、商品マスタへ反映する前に確認が必要です。</p>
          </div>

          <div className={styles.reviewSummary}>
            <StatusCard label="NEW_CANDIDATE" value={stats.pendingReview.newCandidate} unit="件" />
            <StatusCard label="UNMATCHED" value={stats.pendingReview.unmatched} unit="件" />
          </div>

          {pendingItems.length === 0 ? (
            <p className={styles.emptyState}>現在、紐づけ確認が必要な差分はありません。</p>
          ) : (
            <ul className={styles.pendingList}>
              {pendingItems.map((item) => {
                const productName = getTextField(item.after, [
                  "productName",
                  "product_name",
                  "productNameRaw",
                  "product_name_raw",
                ]);
                const spec = getTextField(item.after, ["spec", "specRaw", "spec_raw"]);
                return (
                  <li key={item.diffItemId} className={styles.pendingItem}>
                    <div>
                      <span className={styles.badge}>
                        {getClassificationLabel(item.classification)}
                      </span>
                      <h3>{productName ?? item.fileName}</h3>
                      <p>
                        {item.fileName} / 仕入先: {item.vendorName ?? "-"} / 請求日:{" "}
                        {formatDate(item.invoiceDate)}
                      </p>
                      {spec && <p>規格: {spec}</p>}
                    </div>
                    <Link href={`/documents/${item.documentId}/diff`} className={styles.reviewLink}>
                      差分を確認
                    </Link>
                  </li>
                );
              })}
            </ul>
          )}
        </section>
      </main>
    </>
  );
}

function StatusCard({
  label,
  value,
  unit,
  accent,
}: {
  label: string;
  value: number;
  unit: string;
  accent?: boolean;
}) {
  return (
    <div className={`${styles.statusCard} ${accent ? styles.statusCardAccent : ""}`}>
      <span>{label}</span>
      <strong>
        {value.toLocaleString("ja-JP")}
        <small>{unit}</small>
      </strong>
    </div>
  );
}
