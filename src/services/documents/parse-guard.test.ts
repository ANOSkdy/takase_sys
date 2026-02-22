import { describe, expect, it } from "vitest";
import { assertSinglePagePdf } from "@/services/documents/parse-guard";

describe("assertSinglePagePdf", () => {
  it("accepts a one-page PDF", () => {
    const onePage = Buffer.from(
      "%PDF-1.7\n1 0 obj\n<< /Type /Pages /Count 1 >>\nendobj\n",
      "latin1",
    );
    expect(() => assertSinglePagePdf(onePage)).not.toThrow();
  });

  it("throws for multi-page PDF", () => {
    const twoPage = Buffer.from(
      "%PDF-1.7\n1 0 obj\n<< /Type /Pages /Count 2 >>\nendobj\n",
      "latin1",
    );
    expect(() => assertSinglePagePdf(twoPage)).toThrow("MULTI_PAGE_DOCUMENT_NOT_ALLOWED");
  });
});
