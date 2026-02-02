const SPACE_REGEX = /[\s\u3000]+/g;
const LINE_BREAK_REGEX = /[\r\n\t]+/g;

export function normalizeText(input: string): string {
  return input
    .normalize("NFKC")
    .replace(LINE_BREAK_REGEX, " ")
    .replace(SPACE_REGEX, " ")
    .trim();
}

export function makeProductKey(name: string, spec?: string | null): string {
  const nameN = normalizeText(name);
  const specN = spec ? normalizeText(spec) : "";
  return specN ? `${nameN}｜${specN}` : nameN;
}
