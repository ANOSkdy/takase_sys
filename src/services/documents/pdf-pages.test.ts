import { describe, expect, it } from "vitest";
import { detectPdfPageCount } from "@/services/documents/pdf-pages";

describe("detectPdfPageCount", () => {
  it("prioritizes /Type /Pages object count", () => {
    const pdfLike = Buffer.from(
      `%PDF-1.7\n1 0 obj\n<< /Type /Page /Count 1 >>\nendobj\n2 0 obj\n<< /Type /Pages /Count 16 /Kids [3 0 R] >>\nendobj\n`,
      "latin1",
    );

    expect(detectPdfPageCount(pdfLike)).toBe(16);
  });

  it("falls back to global /Count scan when page tree object is absent", () => {
    const pdfLike = Buffer.from("%PDF-1.7\n/Count 4\n", "latin1");
    expect(detectPdfPageCount(pdfLike)).toBe(4);
  });

  it("returns 1 when count cannot be detected", () => {
    const pdfLike = Buffer.from("%PDF-1.7\n", "latin1");
    expect(detectPdfPageCount(pdfLike)).toBe(1);
  });
});
