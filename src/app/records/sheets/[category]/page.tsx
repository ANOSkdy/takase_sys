import { notFound } from "next/navigation";
import SharedNavHeader from "@/app/shared-nav-header";
import {
  getProductSheetGrid,
  listProductSheetCategories,
  productSheetCategoryParamSchema,
} from "@/services/records/sheets";
import ProductSheetViewer from "../sheet-viewer";
import styles from "../sheets.module.css";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

export default async function ProductSheetCategoryPage({
  params,
}: {
  params: Promise<{ category: string }>;
}) {
  const parsed = productSheetCategoryParamSchema.safeParse(await params);
  if (!parsed.success) notFound();

  const [categories, grid] = await Promise.all([
    listProductSheetCategories(),
    getProductSheetGrid(parsed.data.category),
  ]);

  return (
    <>
      <SharedNavHeader />
      <main className={styles.page}>
        <ProductSheetViewer categories={categories} grid={grid} />
      </main>
    </>
  );
}
