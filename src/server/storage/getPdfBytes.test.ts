import { beforeEach, describe, expect, it, vi } from "vitest";

const getObjectBytes = vi.fn();

vi.mock("@/services/storage", () => ({
  getObjectBytes,
}));

describe("getPdfBytesFromStorageKey", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns bytes for a valid PDF response", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        arrayBuffer: async () => new TextEncoder().encode("%PDF-1.7\nbody").buffer,
      }),
    );

    const { getPdfBytesFromStorageKey } = await import("@/server/storage/getPdfBytes");
    const bytes = await getPdfBytesFromStorageKey("https://example.com/file.pdf");

    expect(bytes.subarray(0, 4).toString("ascii")).toBe("%PDF");
  });

  it("throws PDF_FETCH_NOT_PDF for non-pdf payload", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        arrayBuffer: async () => new TextEncoder().encode("<!DOCTYPE html>").buffer,
      }),
    );

    const { getPdfBytesFromStorageKey } = await import("@/server/storage/getPdfBytes");
    await expect(getPdfBytesFromStorageKey("https://example.com/file.pdf")).rejects.toThrow("PDF_FETCH_NOT_PDF");
  });

  it("throws PDF_FETCH_HTTP_<status> for non-200 response", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: false,
        status: 404,
      }),
    );

    const { getPdfBytesFromStorageKey } = await import("@/server/storage/getPdfBytes");
    await expect(getPdfBytesFromStorageKey("https://example.com/file.pdf")).rejects.toThrow("PDF_FETCH_HTTP_404");
  });

  it("throws PDF_FETCH_EMPTY for empty payload", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        arrayBuffer: async () => new ArrayBuffer(0),
      }),
    );

    const { getPdfBytesFromStorageKey } = await import("@/server/storage/getPdfBytes");
    await expect(getPdfBytesFromStorageKey("https://example.com/file.pdf")).rejects.toThrow("PDF_FETCH_EMPTY");
  });

  it("uses storage provider for pathname-like storageKey", async () => {
    getObjectBytes.mockResolvedValue(Buffer.from("%PDF-1.7\nfrom-storage"));
    const { getPdfBytesFromStorageKey } = await import("@/server/storage/getPdfBytes");

    const bytes = await getPdfBytesFromStorageKey("documents/a.pdf");

    expect(bytes.subarray(0, 4).toString("ascii")).toBe("%PDF");
    expect(getObjectBytes).toHaveBeenCalledWith("documents/a.pdf");
  });
});
