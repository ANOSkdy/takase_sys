import "server-only";

type PdfPageDoc = {
  copyPages(source: PdfPageDoc, indexes: number[]): Promise<unknown[]>;
  addPage(page: unknown): void;
  save(): Promise<Uint8Array>;
  getPageCount(): number;
};

type PdfLibModule = {
  PDFDocument: {
    load(input: Buffer): Promise<PdfPageDoc>;
    create(): Promise<PdfPageDoc>;
  };
};

export type SinglePagePdf = {
  pageNo: number;
  bytes: Buffer;
};

async function loadPdfLib(): Promise<PdfLibModule> {
  try {
    const importer = new Function('return import("pdf-lib")') as () => Promise<PdfLibModule>;
    return await importer();
  } catch {
    throw new Error("PDF_LIB_NOT_AVAILABLE");
  }
}

export async function splitPdfToSinglePages(
  pdfBytes: Buffer,
  maxPages: number,
): Promise<{ pageCount: number; processedPages: number; pages: SinglePagePdf[] }> {
  const { PDFDocument } = await loadPdfLib();
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
