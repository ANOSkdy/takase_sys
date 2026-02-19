import { normalizeText } from "@/domain/normalize";

export const PDF_DEFAULT_CATEGORY = "未分類";

export function normalizeIncomingCategory(category: string | null | undefined): string | null {
  if (typeof category !== "string") return null;
  const normalized = normalizeText(category);
  if (!normalized) return null;
  return normalized === PDF_DEFAULT_CATEGORY ? null : normalized;
}

export function resolveCategory(input: {
  existing: string | null | undefined;
  incoming: string | null | undefined;
}): string {
  return (
    normalizeIncomingCategory(input.incoming) ??
    normalizeIncomingCategory(input.existing) ??
    PDF_DEFAULT_CATEGORY
  );
}
