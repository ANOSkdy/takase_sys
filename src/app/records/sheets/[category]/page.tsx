import { notFound } from "next/navigation";
import { z } from "zod";
import SharedNavHeader from "@/app/shared-nav-header";
import { getProductSheetGrid, listProductSheetCategories } from "@/services/records/sheets";
import ProductSheetViewer from "../sheet-viewer";
import styles from "../sheets.module.css";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

const categoryParamSchema = z.object({
  category: z.string().trim().min(1).max(200),
});

export default async function ProductSheetCategoryPage({
  params,
}: {
  params: Promise<{ category: string }>;
}) {
  const parsed = categoryParamSchema.safeParse(await params);
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
