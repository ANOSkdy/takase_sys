import { describe, expect, it } from "vitest";
import {
  getPdfPageCount,
  PdfSplitError,
  splitPdfPagesSequentially,
  type PdfLibAdapter,
} from "@/services/documents/pdf-split";

function createFakePdfAdapter(pageCount: number): PdfLibAdapter {
  return {
    async load() {
      return {
        getPageCount: () => pageCount,
        copyPages: async (_source, indices) => indices.map((index) => ({ index })),
        addPage: () => undefined,
        save: async () => new Uint8Array([0]),
      };
    },
    async create() {
      let currentIndex = 0;
      return {
        getPageCount: () => 1,
        copyPages: async () => [{ index: currentIndex }],
        addPage: (page: unknown) => {
          currentIndex = (page as { index: number }).index;
        },
        save: async () => new Uint8Array([currentIndex + 1]),
      };
    },
  };
}

describe("splitPdfPagesSequentially", () => {
  it("splits N pages sequentially", async () => {
    const pages: Array<{ pageNumber: number; pageTotal: number; value: number }> = [];
    await splitPdfPagesSequentially(
      new Uint8Array([1, 2, 3]),
      async (page) => {
        pages.push({ pageNumber: page.pageNumber, pageTotal: page.pageTotal, value: page.bytes[0] ?? 0 });
      },
      createFakePdfAdapter(3),
    );

    expect(pages.map((page) => ({ pageNumber: page.pageNumber, pageTotal: page.pageTotal }))).toEqual([
      { pageNumber: 1, pageTotal: 3 },
      { pageNumber: 2, pageTotal: 3 },
      { pageNumber: 3, pageTotal: 3 },
    ]);
  });

  it("returns page count", async () => {
    const count = await getPdfPageCount(new Uint8Array([1]), createFakePdfAdapter(4));
    expect(count).toBe(4);
  });

  it("classifies per-page upload errors", async () => {
    await expect(
      splitPdfPagesSequentially(
        new Uint8Array([1]),
        async () => {
          throw new PdfSplitError("PDF_SPLIT_PAGE_UPLOAD_FAILED", "failed", { pageNumber: 1 });
        },
        createFakePdfAdapter(1),
      ),
    ).rejects.toMatchObject({ code: "PDF_SPLIT_PAGE_UPLOAD_FAILED", pageNumber: 1 });
  });

  it("classifies runtime unavailable errors", async () => {
    const badAdapter: PdfLibAdapter = {
      load: async () => {
        throw new Error("PDF_LIB_RUNTIME_UNAVAILABLE");
      },
      create: async () => {
        throw new Error("PDF_LIB_RUNTIME_UNAVAILABLE");
      },
    };

    await expect(getPdfPageCount(new Uint8Array([1]), badAdapter)).rejects.toMatchObject({
      code: "PDF_SPLIT_RUNTIME_UNAVAILABLE",
    });
  });
});
