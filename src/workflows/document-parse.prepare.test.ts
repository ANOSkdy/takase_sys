import { beforeEach, describe, expect, it, vi } from "vitest";

const upsertPageAsset = vi.fn();

vi.mock("workflow", () => ({
  FatalError: class FatalError extends Error {},
  RetryableError: class RetryableError extends Error {},
  getStepMetadata: () => ({ stepId: "step-1", attempt: 1 }),
}));

vi.mock("@/services/documents/page-assets-repository", () => ({
  listPageAssets: vi.fn(),
  upsertPageAsset,
}));

vi.mock("@/services/storage", () => ({
  getObjectBytes: vi.fn(),
  putObjectBytes: vi.fn(),
}));

vi.mock("@/services/ai/gemini", () => ({
  parseSinglePage: vi.fn(),
}));

vi.mock("@/services/documents/parse-pages-repository", () => ({
  getDocumentParsePageStatus: vi.fn(),
  listFailedPageNos: vi.fn(),
  listSucceededParsePages: vi.fn(),
  upsertDocumentParsePage: vi.fn(),
}));

vi.mock("@/db/client", () => ({
  getDb: vi.fn(() => ({
    transaction: vi.fn(async (cb: (tx: { update: () => { set: () => { where: () => Promise<void> } } }) => Promise<void>) =>
      cb({
        update: () => ({
          set: () => ({ where: async () => undefined }),
        }),
      }),
    ),
  })),
}));

describe("preparePageAssetsStep", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("uses single-asset fallback when pdf-lib load fails", async () => {
    const bytes = Buffer.from("%PDF-1.7\nhello\n%%EOF");
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        arrayBuffer: async () => bytes,
      }),
    );

    const { preparePageAssetsStep } = await import("@/workflows/document-parse");
    const result = await preparePageAssetsStep({
      parseRunId: "dd655ae9-02a0-46c3-aa24-3e10465654dc",
      documentId: "6d2cfed6-0f31-4edb-9f75-f20f6ba266ce",
      storageKey: "https://example.com/original.pdf",
    });

    expect(result).toEqual({ pageCount: 1, processedPages: 1, isFallback: true });
    expect(upsertPageAsset).toHaveBeenCalledWith(
      "6d2cfed6-0f31-4edb-9f75-f20f6ba266ce",
      1,
      "https://example.com/original.pdf",
      expect.any(String),
      bytes.byteLength,
      "application/pdf",
    );
  });
});
