import { beforeEach, describe, expect, it, vi } from "vitest";

const getDocumentParsePageStatus = vi.fn();
const upsertDocumentParsePage = vi.fn();
const parseSinglePage = vi.fn();
const listPageAssets = vi.fn();
const getObjectBytes = vi.fn();

vi.mock("workflow", () => ({
  FatalError: class FatalError extends Error {},
  RetryableError: class RetryableError extends Error {},
  getStepMetadata: () => ({ stepId: "step-1", attempt: 1 }),
}));

vi.mock("@/services/documents/parse-pages-repository", () => ({
  getDocumentParsePageStatus,
  upsertDocumentParsePage,
  listFailedPageNos: vi.fn(),
  listSucceededParsePages: vi.fn(),
}));

vi.mock("@/services/documents/page-assets-repository", () => ({
  listPageAssets,
  upsertPageAsset: vi.fn(),
}));

vi.mock("@/services/ai/gemini", () => ({
  parseSinglePage,
}));

vi.mock("@/db/client", () => ({
  getDb: vi.fn(),
}));

vi.mock("@/services/storage", () => ({
  getObjectBytes,
  putObjectBytes: vi.fn(),
}));

describe("parsePdfPageStep", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getDocumentParsePageStatus.mockResolvedValue(null);
    parseSinglePage.mockResolvedValue({ vendorName: null, invoiceDate: null, lineItems: [] });
    upsertDocumentParsePage.mockResolvedValue(undefined);
    listPageAssets.mockResolvedValue([
      {
        pageNo: 1,
        storageKey: "documents/id/pages/page-1.pdf",
        pageHash: "a".repeat(64),
        byteSize: 10,
        mimeType: "application/pdf",
      },
    ]);
    getObjectBytes.mockResolvedValue(Buffer.from("pdf"));
  });

  it("persists RUNNING page status before Gemini parsing", async () => {
    const { parsePdfPageStep } = await import("@/workflows/document-parse");

    await parsePdfPageStep("dd655ae9-02a0-46c3-aa24-3e10465654dc", "6d2cfed6-0f31-4edb-9f75-f20f6ba266ce", 1);

    expect(upsertDocumentParsePage).toHaveBeenCalledWith(
      expect.objectContaining({
        parseRunId: "dd655ae9-02a0-46c3-aa24-3e10465654dc",
        pageNo: 1,
        patch: expect.objectContaining({ status: "RUNNING", markStartedAt: true }),
      }),
    );
    expect(parseSinglePage).toHaveBeenCalledTimes(1);
    expect(upsertDocumentParsePage.mock.invocationCallOrder[0]).toBeLessThan(
      parseSinglePage.mock.invocationCallOrder[0],
    );
  });
});
