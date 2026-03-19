export function normalizeText(input: string): string {
  return input
    .normalize("NFKC")
    .replace(/[\t\r\n]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function makeProductKey(
  productName: string,
  spec?: string | null,
  productMaker?: string | null,
): string {
  const nameNormalized = normalizeText(productName);
  if (!nameNormalized) return "";
  const makerNormalized = productMaker ? normalizeText(productMaker) : "";
  const specNormalized = spec ? normalizeText(spec) : "";
  const namePart = makerNormalized ? `${makerNormalized}｜${nameNormalized}` : nameNormalized;
  return specNormalized ? `${namePart}｜${specNormalized}` : namePart;
}
