export function normalizeText(input: string): string {
  return input.replace(/\s+/g, " ").trim();
}

export function makeProductKey(productName: string, spec?: string | null): string {
  const base = [productName, spec ?? ""].filter(Boolean).join(" ");
  return normalizeText(base).toLowerCase();
}
