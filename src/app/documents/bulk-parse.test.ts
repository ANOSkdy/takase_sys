import { describe, expect, it, vi } from "vitest";
import type { DocumentListItem } from "@/services/documents/types";
import { bulkParseSelected } from "@/app/documents/bulk-parse";

function jsonResponse(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function item(overrides: Partial<DocumentListItem>): DocumentListItem {
  return {
    documentId: "00000000-0000-0000-0000-000000000001",
    fileName: "sample.pdf",
    uploadGroupId: "group-1",
    pageNumber: 1,
    pageTotal: 2,
    sourceFileHash: null,
    uploadedAt: "2026-02-20T00:00:00.000Z",
    status: "UPLOADED",
    vendorName: null,
    invoiceDate: null,
    uploadNote: null,
    ...overrides,
  };
}

describe("bulkParseSelected", () => {
  it("parses documents sequentially in sorted order", async () => {
    const items = [
      item({
        documentId: "00000000-0000-0000-0000-000000000002",
        pageNumber: 2,
      }),
      item({
        documentId: "00000000-0000-0000-0000-000000000001",
        pageNumber: 1,
      }),
    ];

    const calls: string[] = [];
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      calls.push(`${init?.method ?? "GET"}:${url}`);
      if (url.endsWith("/parse")) {
        return jsonResponse({ ok: true }, 202);
      }
      return jsonResponse({ status: "PARSED" });
    });

    await bulkParseSelected({
      items,
      selectedIds: new Set(items.map((d) => d.documentId)),
      fetchImpl: fetchMock,
    });

    expect(calls).toEqual([
      "POST:/api/documents/00000000-0000-0000-0000-000000000001/parse",
      "GET:/api/documents/00000000-0000-0000-0000-000000000001",
      "POST:/api/documents/00000000-0000-0000-0000-000000000002/parse",
      "GET:/api/documents/00000000-0000-0000-0000-000000000002",
    ]);
  });

  it("skips already parsed documents", async () => {
    const parsed = item({
      documentId: "00000000-0000-0000-0000-000000000003",
      status: "PARSED",
    });
    const uploaded = item({
      documentId: "00000000-0000-0000-0000-000000000004",
      pageNumber: 2,
      status: "UPLOADED",
    });

    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      if (init?.method === "POST") return jsonResponse({ ok: true }, 202);
      return jsonResponse({ status: "PARSED" });
    });

    const result = await bulkParseSelected({
      items: [parsed, uploaded],
      selectedIds: new Set([parsed.documentId, uploaded.documentId]),
      fetchImpl: fetchMock,
    });

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(result.skipped).toBe(1);
    expect(result.success).toBe(1);
  });

  it("continues to next document after failure", async () => {
    const first = item({ documentId: "00000000-0000-0000-0000-000000000011", pageNumber: 1 });
    const second = item({ documentId: "00000000-0000-0000-0000-000000000012", pageNumber: 2 });

    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      if (url.includes("00000000-0000-0000-0000-000000000011") && init?.method === "POST") {
        return new Response("boom", { status: 500 });
      }
      if (init?.method === "POST") {
        return jsonResponse({ ok: true }, 202);
      }
      return jsonResponse({ status: "PARSED" });
    });

    const result = await bulkParseSelected({
      items: [first, second],
      selectedIds: new Set([first.documentId, second.documentId]),
      fetchImpl: fetchMock,
    });

    expect(result.failed).toBe(1);
    expect(result.success).toBe(1);
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/documents/00000000-0000-0000-0000-000000000012/parse",
      { method: "POST" },
    );
  });
});
