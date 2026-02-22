"use client";

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

type PdfDocumentStatic = {
  load(pdfBytes: Uint8Array): Promise<PdfDoc>;
  create(): Promise<PdfDoc>;
};

export type PdfLibAdapter = {
  load(pdfBytes: Uint8Array): Promise<PdfDoc>;
  create(): Promise<PdfDoc>;
};

export type PdfSplitErrorCode =
  | "PDF_SPLIT_RUNTIME_UNAVAILABLE"
  | "PDF_SPLIT_FAILED"
  | "PDF_SPLIT_PAGE_UPLOAD_FAILED";

export class PdfSplitError extends Error {
  code: PdfSplitErrorCode;
  pageNumber?: number;

  constructor(
    code: PdfSplitErrorCode,
    message: string,
    options?: { cause?: unknown; pageNumber?: number },
  ) {
    super(message, { cause: options?.cause });
    this.code = code;
    this.pageNumber = options?.pageNumber;
  }
}

export async function getPdfPageCount(
  pdfBytes: Uint8Array,
  adapter?: PdfLibAdapter,
): Promise<number> {
  const pdfLib = adapter ?? (await loadPdfLibAdapter());
  try {
    const srcDoc = await pdfLib.load(pdfBytes);
    return srcDoc.getPageCount();
  } catch (error) {
    throw normalizeSplitError(error, "PDF_SPLIT_FAILED", "PDFページ数の取得に失敗しました。");
  }
}

export async function splitPdfPagesSequentially(
  pdfBytes: Uint8Array,
  onPage: (page: SplitPdfPage) => Promise<void>,
  adapter?: PdfLibAdapter,
): Promise<void> {
  const pdfLib = adapter ?? (await loadPdfLibAdapter());

  let srcDoc: PdfDoc;
  try {
    srcDoc = await pdfLib.load(pdfBytes);
  } catch (error) {
    throw normalizeSplitError(error, "PDF_SPLIT_FAILED", "PDFの読み込みに失敗しました。");
  }

  const pageTotal = srcDoc.getPageCount();
  for (let index = 0; index < pageTotal; index += 1) {
    try {
      const pageDoc = await pdfLib.create();
      const [copied] = await pageDoc.copyPages(srcDoc, [index]);
      pageDoc.addPage(copied);
      const bytes = await pageDoc.save();
      await onPage({ pageNumber: index + 1, pageTotal, bytes });
    } catch (error) {
      if (error instanceof PdfSplitError) throw error;
      throw normalizeSplitError(
        error,
        "PDF_SPLIT_FAILED",
        `PDF分割に失敗しました（page ${index + 1}/${pageTotal}）`,
        index + 1,
      );
    }
  }
}

async function loadPdfLibAdapter(): Promise<PdfLibAdapter> {
  const triedErrors: unknown[] = [];
  const importFromUrl = new Function("url", "return import(/* webpackIgnore: true */ url)") as (
    url: string,
  ) => Promise<{ PDFDocument?: PdfDocumentStatic }>;

  const candidates: Array<() => Promise<{ PDFDocument?: PdfDocumentStatic }>> = [
    () => import("pdf-lib"),
    () => importFromUrl("https://cdn.jsdelivr.net/npm/pdf-lib@1.17.1/+esm"),
  ];

  for (const candidate of candidates) {
    try {
      const mod = await candidate();
      const PDFDocument = mod?.PDFDocument;
      if (
        !PDFDocument ||
        typeof PDFDocument.load !== "function" ||
        typeof PDFDocument.create !== "function"
      ) {
        throw new Error("PDFDocument API not available");
      }
      await PDFDocument.create();
      return {
        load: (bytes) => PDFDocument.load(bytes),
        create: () => PDFDocument.create(),
      };
    } catch (error) {
      triedErrors.push(error);
    }
  }

  throw normalizeSplitError(
    triedErrors[triedErrors.length - 1],
    "PDF_SPLIT_RUNTIME_UNAVAILABLE",
    "PDF分割ランタイムの読み込みに失敗しました。ブラウザを再読み込みして再試行してください。",
  );
}

function normalizeSplitError(
  error: unknown,
  fallbackCode: PdfSplitErrorCode,
  fallbackMessage: string,
  pageNumber?: number,
): PdfSplitError {
  if (error instanceof PdfSplitError) return error;

  const message = error instanceof Error ? error.message : String(error);
  if (message.includes("PDF_LIB_RUNTIME_UNAVAILABLE")) {
    return new PdfSplitError(
      "PDF_SPLIT_RUNTIME_UNAVAILABLE",
      "PDF分割ランタイムを利用できません。ブラウザを最新版に更新して再試行してください。",
      { cause: error, pageNumber },
    );
  }

  return new PdfSplitError(fallbackCode, fallbackMessage, { cause: error, pageNumber });
}
