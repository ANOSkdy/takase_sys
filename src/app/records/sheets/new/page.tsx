import SharedNavHeader from "@/app/shared-nav-header";
import { listProductSheetCategories } from "@/services/records/sheets";
import styles from "../sheets.module.css";
import NewSheetForm from "./new-sheet-form";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

export default async function NewProductSheetPage() {
  const categories = await listProductSheetCategories();

  return (
    <>
      <SharedNavHeader />
      <main className={styles.page}>
        <header className={styles.header}>
          <div className={styles.headerText}>
            <h1>シート追加</h1>
            <p>新しいシート名と最初の商品を登録します。</p>
          </div>
        </header>
        <NewSheetForm existingCategories={categories.map((item) => item.category)} />
      </main>
    </>
  );
}
