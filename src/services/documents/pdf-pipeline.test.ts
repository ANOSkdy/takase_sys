import { describe, expect, it, vi } from "vitest";
import { parseInvoiceFromPdfPages } from "@/services/documents/pdf-pipeline";

describe("parseInvoiceFromPdfPages", () => {
  it("processes more than page 1 for multi-page PDFs", async () => {
    const parsePage = vi.fn(async ({ pageNumber }: { pageNumber: number }) => ({
      vendorName: pageNumber === 1 ? "A商事" : null,
      invoiceDate: pageNumber === 1 ? "2026-01-01" : null,
      lineItems: [
        {
          lineNo: 1,
          productName: `item-${pageNumber}`,
          spec: null,
          quantity: 1,
          unitPrice: 10,
          amount: 10,
          confidence: 0.9,
        },
      ],
    }));

    const pdfLikeBuffer = Buffer.from("%PDF-1.7\n/Count 3\n/Type /Pages\n", "latin1");

    const result = await parseInvoiceFromPdfPages({
      pdfBuffer: pdfLikeBuffer,
      maxPages: 30,
      parsePage,
    });

    expect(result.pageCount).toBe(3);
    expect(result.processedPages).toBe(3);
    expect(parsePage).toHaveBeenCalledTimes(3);
    expect(parsePage).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ pageNumber: 2, totalPages: 3 }),
    );
    expect(result.invoice.lineItems).toHaveLength(3);
  });

  it("fails without returning partial results when a page parse errors", async () => {
    const parsePage = vi.fn(async ({ pageNumber }: { pageNumber: number }) => {
      if (pageNumber === 2) throw new Error("PAGE_PARSE_FAILED");
      return {
        vendorName: "A商事",
        invoiceDate: "2026-01-01",
        lineItems: [
          {
            lineNo: 1,
            productName: `item-${pageNumber}`,
            spec: null,
            quantity: 1,
            unitPrice: 10,
            amount: 10,
            confidence: 0.9,
          },
        ],
      };
    });

    const pdfLikeBuffer = Buffer.from("%PDF-1.7\n/Count 3\n/Type /Pages\n", "latin1");

    await expect(
      parseInvoiceFromPdfPages({
        pdfBuffer: pdfLikeBuffer,
        maxPages: 30,
        parsePage,
      }),
    ).rejects.toThrow("PAGE_PARSE_FAILED");
    expect(parsePage).toHaveBeenCalledTimes(2);
  });
});
