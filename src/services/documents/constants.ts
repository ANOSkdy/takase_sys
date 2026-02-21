import { getEnv } from "@/config/env";

const DEFAULT_MAX_PDF_MB = 20;
const DEFAULT_MAX_PDF_PAGES = 30;

export function getMaxPdfSizeMb(): number {
  const env = getEnv();
  return env.APP_MAX_PDF_MB ?? DEFAULT_MAX_PDF_MB;
}

export function getMaxPdfSizeBytes(): number {
  return getMaxPdfSizeMb() * 1024 * 1024;
}

// Limits how many single-page assets are generated/processed in one run.
export function getMaxPdfPages(): number {
  const env = getEnv();
  return env.APP_MAX_PDF_PAGES ?? DEFAULT_MAX_PDF_PAGES;
}
