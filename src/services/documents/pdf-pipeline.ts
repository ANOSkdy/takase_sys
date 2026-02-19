import type { ParsedInvoice } from "@/services/ai/schema";
import { mergeParsedInvoices } from "@/services/documents/page-merge";
import { detectPdfPageCount } from "@/services/documents/pdf-pages";

type ParsePageFn = (input: { pdfBase64: string; pageNumber: number; totalPages: number }) => Promise<ParsedInvoice>;

// Current policy: fail-fast. If any page parse fails, reject and persist nothing from this parse run.
export async function parseInvoiceFromPdfPages(input: {
  pdfBuffer: Buffer;
  maxPages: number;
  parsePage: ParsePageFn;
}): Promise<{ invoice: ParsedInvoice; pageCount: number; processedPages: number }> {
  const pageCount = detectPdfPageCount(input.pdfBuffer);
  const processedPages = Math.min(pageCount, Math.max(1, input.maxPages));
  const pdfBase64 = input.pdfBuffer.toString("base64");

  const pages: ParsedInvoice[] = [];
  for (let pageNumber = 1; pageNumber <= processedPages; pageNumber += 1) {
    pages.push(await input.parsePage({ pdfBase64, pageNumber, totalPages: pageCount }));
  }

  return {
    invoice: mergeParsedInvoices(pages),
    pageCount,
    processedPages,
  };
}
