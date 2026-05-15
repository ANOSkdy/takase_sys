import SharedNavHeader from "@/app/shared-nav-header";
import { getProductSheetGrid, listProductSheetCategories } from "@/services/records/sheets";
import ProductSheetViewer from "./sheet-viewer";
import styles from "./sheets.module.css";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

export default async function ProductSheetsPage() {
  const categories = await listProductSheetCategories();
  const firstCategory = categories[0]?.category;
  const grid = firstCategory ? await getProductSheetGrid(firstCategory) : null;

  return (
    <>
      <SharedNavHeader />
      <main className={styles.page}>
        <ProductSheetViewer categories={categories} grid={grid} />
      </main>
    </>
  );
}
