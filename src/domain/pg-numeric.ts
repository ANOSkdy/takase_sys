const numericPattern = /^-?\d+(\.\d+)?$/;

export function safeParseFloat(value: string | number | null | undefined): number | null {
  if (value === null || value === undefined) return null;
  if (typeof value === "number") {
    return Number.isFinite(value) ? value : null;
  }
  const trimmed = value.trim();
  if (!trimmed) return null;
  if (!numericPattern.test(trimmed)) return null;
  const parsed = Number(trimmed);
  return Number.isFinite(parsed) ? parsed : null;
}

export function toNumericString(
  value: string | number | null | undefined,
  scale: number,
): string | null {
  const parsed = safeParseFloat(value);
  if (parsed === null) return null;
  return parsed.toFixed(scale);
}
