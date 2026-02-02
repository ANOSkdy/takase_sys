import { describe, expect, it } from "vitest";
import { validateInitUpload } from "@/services/documents/upload";

const maxBytes = 20 * 1024 * 1024;

describe("validateInitUpload", () => {
  it("rejects non-pdf content type", () => {
    const result = validateInitUpload(
      { fileName: "test.png", contentType: "image/png", size: 1000 },
      maxBytes,
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.status).toBe(415);
  });

  it("rejects oversized pdf", () => {
    const result = validateInitUpload(
      { fileName: "test.pdf", contentType: "application/pdf", size: maxBytes + 1 },
      maxBytes,
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.status).toBe(413);
  });

  it("accepts valid pdf", () => {
    const result = validateInitUpload(
      { fileName: "test.pdf", contentType: "application/pdf", size: maxBytes - 1 },
      maxBytes,
    );
    expect(result.ok).toBe(true);
  });
});
