import { describe, expect, it, vi } from "vitest";

vi.mock("@/services/documents/repository", () => ({
  getDocumentDetail: vi.fn(),
  softDeleteDocument: vi.fn(),
}));

import { DELETE } from "@/app/api/documents/[documentId]/route";
import { softDeleteDocument } from "@/services/documents/repository";

const mockedSoftDelete = vi.mocked(softDeleteDocument);

describe("DELETE /api/documents/[documentId]", () => {
  it("soft deletes document", async () => {
    mockedSoftDelete.mockResolvedValue({ documentId: "doc-123", status: "DELETED" });

    const req = new Request("http://localhost/api/documents/doc-123", {
      method: "DELETE",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ deletedReason: "不要" }),
    });

    const res = await DELETE(req, {
      params: { documentId: "11111111-1111-1111-8111-111111111111" },
    });

    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.status).toBe("DELETED");
  });
});
