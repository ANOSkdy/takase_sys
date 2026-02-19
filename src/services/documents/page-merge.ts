import type { ParsedInvoice } from "@/services/ai/schema";

export function mergeParsedInvoices(pages: ParsedInvoice[]): ParsedInvoice {
  const vendorName = pages.find((page) => page.vendorName)?.vendorName ?? null;
  const invoiceDate = pages.find((page) => page.invoiceDate)?.invoiceDate ?? null;

  let nextLineNo = 1;
  const lineItems = pages.flatMap((page) =>
    page.lineItems.map((item) => ({
      ...item,
      lineNo: nextLineNo++,
    })),
  );

  return {
    vendorName,
    invoiceDate,
    lineItems,
  };
}
