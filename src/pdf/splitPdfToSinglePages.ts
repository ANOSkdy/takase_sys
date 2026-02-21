import "server-only";
import { PDFDocument } from "pdf-lib";

export type SinglePagePdf = {
  pageNo: number;
  bytes: Buffer;
};

export async function splitPdfToSinglePages(
  pdfBytes: Buffer,
  maxPages: number,
): Promise<{ pageCount: number; processedPages: number; pages: SinglePagePdf[] }> {
  const sourcePdf = await PDFDocument.load(pdfBytes);
  const pageCount = sourcePdf.getPageCount();
  const processedPages = Math.min(pageCount, maxPages);
  const pages: SinglePagePdf[] = [];

  for (let i = 0; i < processedPages; i += 1) {
    const singlePagePdf = await PDFDocument.create();
    const [copiedPage] = await singlePagePdf.copyPages(sourcePdf, [i]);
    singlePagePdf.addPage(copiedPage);
    const savedBytes = await singlePagePdf.save();
    pages.push({ pageNo: i + 1, bytes: Buffer.from(savedBytes) });
  }

  return { pageCount, processedPages, pages };
}
