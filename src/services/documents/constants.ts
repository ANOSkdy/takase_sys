import { getEnv } from "@/config/env";

const DEFAULT_MAX_PDF_MB = 20;

export function getMaxPdfSizeMb(): number {
  const env = getEnv();
  return env.APP_MAX_PDF_MB ?? DEFAULT_MAX_PDF_MB;
}

export function getMaxPdfSizeBytes(): number {
  return getMaxPdfSizeMb() * 1024 * 1024;
}
