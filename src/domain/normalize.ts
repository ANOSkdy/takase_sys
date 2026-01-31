export function normalizeText(input: string): string {
  return input.replace(/\s+/g, " ").trim();
}
