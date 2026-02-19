import { describe, expect, it } from "vitest";
import { mergeParsedInvoices } from "@/services/documents/page-merge";

describe("mergeParsedInvoices", () => {
  it("appends page line items without overwriting", () => {
    const merged = mergeParsedInvoices([
      {
        vendorName: "A商事",
        invoiceDate: "2026-01-01",
        lineItems: [{ lineNo: 1, productName: "りんご", spec: null, quantity: 1, unitPrice: 100, amount: 100, confidence: 0.9 }],
      },
      {
        vendorName: null,
        invoiceDate: null,
        lineItems: [{ lineNo: 1, productName: "みかん", spec: null, quantity: 2, unitPrice: 80, amount: 160, confidence: 0.8 }],
      },
    ]);

    expect(merged.vendorName).toBe("A商事");
    expect(merged.invoiceDate).toBe("2026-01-01");
    expect(merged.lineItems).toHaveLength(2);
    expect(merged.lineItems[0]?.lineNo).toBe(1);
    expect(merged.lineItems[1]?.lineNo).toBe(2);
    expect(merged.lineItems[1]?.productName).toBe("みかん");
  });
});
