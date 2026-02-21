import { beforeEach, describe, expect, it, vi } from "vitest";


const getDocumentParsePageStatus = vi.fn();
const upsertDocumentParsePage = vi.fn();
const parseSinglePage = vi.fn();

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

vi.mock("@/services/ai/gemini", () => ({
  parseSinglePage,
}));

vi.mock("@/db/client", () => ({
  getDb: vi.fn(),
}));

vi.mock("@/services/storage", () => ({
  getStorageProvider: vi.fn(),
}));

describe("parsePdfPageStep", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getDocumentParsePageStatus.mockResolvedValue(null);
    parseSinglePage.mockResolvedValue({ vendorName: null, invoiceDate: null, lineItems: [] });
    upsertDocumentParsePage.mockResolvedValue(undefined);
  });

  it("persists RUNNING page status before Gemini parsing", async () => {
    const { parsePdfPageStep } = await import("@/workflows/document-parse");

    await parsePdfPageStep("dd655ae9-02a0-46c3-aa24-3e10465654dc", 1, "base64");

    expect(upsertDocumentParsePage).toHaveBeenCalledWith(
      expect.objectContaining({
        parseRunId: "dd655ae9-02a0-46c3-aa24-3e10465654dc",
        pageNo: 1,
        patch: expect.objectContaining({ status: "RUNNING", markStartedAt: true }),
      }),
    );
    expect(parseSinglePage).toHaveBeenCalledTimes(1);
    expect(upsertDocumentParsePage.mock.invocationCallOrder[0]).toBeLessThan(parseSinglePage.mock.invocationCallOrder[0]);
  });
});
