import { describe, expect, it, vi } from "vitest";

vi.mock("@/services/documents/service", () => ({
  registerDocumentBulk: vi.fn(),
}));

import { POST } from "@/app/api/documents/bulk/route";
import { registerDocumentBulk } from "@/services/documents/service";

const mockedBulk = vi.mocked(registerDocumentBulk);

describe("POST /api/documents/bulk", () => {
  it("returns uploadGroupId and items on success", async () => {
    mockedBulk.mockResolvedValue({
      ok: true,
      data: {
        uploadGroupId: "group-1",
        items: [
          { documentId: "doc-1", pageNumber: 1, status: "UPLOADED" },
          { documentId: "doc-2", pageNumber: 2, status: "UPLOADED" },
        ],
      },
    });

    const req = new Request("http://localhost/api/documents/bulk", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        fileName: "invoice.pdf",
        pages: [
          { storageKey: "a", fileHash: "1", pageNumber: 1, pageTotal: 2 },
          { storageKey: "b", fileHash: "2", pageNumber: 2, pageTotal: 2 },
        ],
      }),
    });

    const res = await POST(req);
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.uploadGroupId).toBe("group-1");
    expect(body.items).toHaveLength(2);
  });
});
