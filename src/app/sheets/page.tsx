import SharedNavHeader from "@/app/shared-nav-header";
import {
  listProductSheetCategories,
  productSheetsSearchSchema,
  searchProductSheetGrid,
} from "@/services/records/sheets";
import ProductSheetViewer from "./sheet-viewer";
import styles from "./sheets.module.css";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

type SearchParams = Record<string, string | string[] | undefined>;

export default async function ProductSheetsPage({
  searchParams,
}: {
  searchParams?: Promise<SearchParams>;
}) {
  const sp = await (searchParams ?? Promise.resolve({} as SearchParams));
  const normalized: Record<string, string | undefined> = {};
  for (const [key, value] of Object.entries(sp)) {
    normalized[key] = Array.isArray(value) ? value[0] : value;
  }

  const parsed = productSheetsSearchSchema.safeParse(normalized);
  const params = parsed.success ? parsed.data : productSheetsSearchSchema.parse({});
  const [categories, grid] = await Promise.all([
    listProductSheetCategories(),
    searchProductSheetGrid(params),
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
