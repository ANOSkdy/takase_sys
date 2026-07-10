import { notFound, redirect } from "next/navigation";
import { productSheetCategoryParamSchema } from "@/services/records/sheets";

export default async function LegacyProductSheetCategoryPage({
  params,
}: {
  params: Promise<{ category: string }>;
}) {
  const parsed = productSheetCategoryParamSchema.safeParse(await params);
  if (!parsed.success) notFound();
  redirect(`/sheets?category=${encodeURIComponent(parsed.data.category)}`);
}
