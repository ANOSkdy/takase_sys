export type SplitPdfPage = {
  pageNumber: number;
  pageTotal: number;
  bytes: Uint8Array;
};

type PdfDoc = {
  getPageCount(): number;
  copyPages(source: PdfDoc, indices: number[]): Promise<unknown[]>;
  addPage(page: unknown): void;
  save(): Promise<Uint8Array>;
};

export type PdfLibAdapter = {
  load(pdfBytes: Uint8Array): Promise<PdfDoc>;
  create(): Promise<PdfDoc>;
};

export async function splitPdfIntoSinglePages(
  pdfBytes: Uint8Array,
  adapter?: PdfLibAdapter,
): Promise<SplitPdfPage[]> {
  const pdfLib = adapter ?? (await loadPdfLibAdapter());
  const srcDoc = await pdfLib.load(pdfBytes);
  const total = srcDoc.getPageCount();
  const pages: SplitPdfPage[] = [];

  for (let index = 0; index < total; index += 1) {
    const pageDoc = await pdfLib.create();
    const [copied] = await pageDoc.copyPages(srcDoc, [index]);
    pageDoc.addPage(copied);
    const bytes = await pageDoc.save();
    pages.push({ pageNumber: index + 1, pageTotal: total, bytes });
  }

  return pages;
}

async function loadPdfLibAdapter(): Promise<PdfLibAdapter> {
  const local = await import("pdf-lib");
  const PDFDocument = local.PDFDocument;
  try {
    await PDFDocument.create();
  } catch {
    throw new Error("PDF_SPLIT_RUNTIME_UNAVAILABLE");
  }
  return {
    load: (bytes) => PDFDocument.load(bytes) as Promise<PdfDoc>,
    create: () => PDFDocument.create() as Promise<PdfDoc>,
  };
}
