import { describe, expect, it } from "vitest";
import { resolveDocumentFileUrl } from "@/services/documents/file-url";

describe("resolveDocumentFileUrl", () => {
  it("accepts Vercel Blob https URLs", () => {
    const url = resolveDocumentFileUrl(
      "https://abc123.public.blob.vercel-storage.com/documents/a.pdf",
    );
    expect(url?.href).toBe("https://abc123.public.blob.vercel-storage.com/documents/a.pdf");
  });

  it("resolves a bare pathname against the blob host", () => {
    expect(resolveDocumentFileUrl("documents/a.pdf")?.href).toBe(
      "https://blob.vercel-storage.com/documents/a.pdf",
    );
  });

  it("rejects other hosts, lookalike hosts and non-https URLs", () => {
    expect(resolveDocumentFileUrl("https://example.com/a.pdf")).toBeNull();
    expect(resolveDocumentFileUrl("https://blob.vercel-storage.com.evil.test/a.pdf")).toBeNull();
    expect(resolveDocumentFileUrl("https://evilblob.vercel-storage.com/a.pdf")).toBeNull();
    expect(resolveDocumentFileUrl("http://abc.public.blob.vercel-storage.com/a.pdf")).toBeNull();
    expect(resolveDocumentFileUrl("http://169.254.169.254/latest/meta-data")).toBeNull();
    expect(resolveDocumentFileUrl("https://user:pw@blob.vercel-storage.com/a.pdf")).toBeNull();
    expect(resolveDocumentFileUrl("https://blob.vercel-storage.com:8443/a.pdf")).toBeNull();
    expect(resolveDocumentFileUrl("  ")).toBeNull();
  });
});
