import { describe, expect, it } from "vitest";
import { splitPdfIntoSinglePages, type PdfLibAdapter } from "@/services/documents/pdf-split";

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

describe("splitPdfIntoSinglePages", () => {
  it("splits N pages into N one-page blobs", async () => {
    const pages = await splitPdfIntoSinglePages(new Uint8Array([1, 2, 3]), createFakePdfAdapter(3));

    expect(pages).toHaveLength(3);
    expect(pages.map((page) => page.pageNumber)).toEqual([1, 2, 3]);
    expect(pages.every((page) => page.pageTotal === 3)).toBe(true);
  });
});
