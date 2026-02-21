import { detectPdfPageCount } from "@/services/documents/pdf-pages";

export function assertSinglePagePdf(pdfBuffer: Buffer): void {
  const pageCount = detectPdfPageCount(pdfBuffer);
  if (pageCount !== 1) {
    throw new Error(`MULTI_PAGE_DOCUMENT_NOT_ALLOWED:${pageCount}`);
  }
}
