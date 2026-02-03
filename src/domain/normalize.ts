export function normalizeText(input: string): string {
  return input
    .normalize("NFKC")
    .replace(/[\t\r\n]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function makeProductKey(productName: string, spec?: string | null): string {
  const nameNormalized = normalizeText(productName);
  if (!nameNormalized) return "";
  const specNormalized = spec ? normalizeText(spec) : "";
  return specNormalized ? `${nameNormalized}｜${specNormalized}` : nameNormalized;
}
