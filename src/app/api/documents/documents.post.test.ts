import { describe, expect, it, vi } from "vitest";

vi.mock("@/services/documents/service", () => ({
  registerDocument: vi.fn(),
}));

import { POST } from "@/app/api/documents/route";
import { registerDocument } from "@/services/documents/service";

const mockedRegister = vi.mocked(registerDocument);

describe("POST /api/documents", () => {
  it("returns document id on success", async () => {
    mockedRegister.mockResolvedValue({
      ok: true,
      data: { documentId: "doc-123", status: "UPLOADED" },
    });

    const req = new Request("http://localhost/api/documents", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        fileName: "invoice.pdf",
        storageKey: "blob-key",
        fileHash: "hash",
      }),
    });

    const res = await POST(req);
    expect(res.status).toBe(201);
    const data = await res.json();
    expect(data.documentId).toBe("doc-123");
  });
});
