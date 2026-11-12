import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@/services/documents/repository", () => ({
  getDocumentDetail: vi.fn(),
}));
vi.mock("@/config/env", () => ({
  getEnv: () => ({ BLOB_READ_WRITE_TOKEN: "test-token" }),
}));

import { GET } from "@/app/api/documents/[documentId]/file/route";
import { getDocumentDetail } from "@/services/documents/repository";

const mockedDetail = vi.mocked(getDocumentDetail);
const documentId = "11111111-1111-1111-8111-111111111111";
const blobUrl = "https://abc.public.blob.vercel-storage.com/documents/a.pdf";

function doc(overrides: Record<string, unknown> = {}) {
  return {
    documentId,
    fileName: "納品書1.pdf",
    storageKey: blobUrl,
    isDeleted: false,
    deletedReason: null,
    ...overrides,
  } as unknown as NonNullable<Awaited<ReturnType<typeof getDocumentDetail>>>;
}

function call(id = documentId) {
  return GET(new Request(`http://localhost/api/documents/${id}/file`), {
    params: Promise.resolve({ documentId: id }),
  });
}

describe("GET /api/documents/[documentId]/file", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  it("streams the PDF without exposing the storage URL", async () => {
    mockedDetail.mockResolvedValue(doc());
    const fetchMock = vi.fn().mockResolvedValue(new Response("%PDF-1.7", { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    const res = await call();

    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("application/pdf");
    expect(res.headers.get("cache-control")).toContain("no-store");
    expect(res.headers.get("content-disposition")).toContain(encodeURIComponent("納品書1.pdf"));
    expect(await res.text()).toBe("%PDF-1.7");
    expect(String(fetchMock.mock.calls[0][0])).toBe(blobUrl);
    expect([...res.headers.values()].join(" ")).not.toContain("vercel-storage");
  });

  it("rejects an invalid id without touching the database", async () => {
    const res = await call("not-a-uuid");
    expect(res.status).toBe(400);
    expect(mockedDetail).not.toHaveBeenCalled();
  });

  it("returns 404 for an unknown document", async () => {
    mockedDetail.mockResolvedValue(null);
    expect((await call()).status).toBe(404);
  });

  it("returns 410 with the reason for a deleted document and does not fetch it", async () => {
    mockedDetail.mockResolvedValue(doc({ isDeleted: true, deletedReason: "誤アップロード" }));
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const res = await call();

    expect(res.status).toBe(410);
    expect((await res.json()).detail).toContain("誤アップロード");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("never fetches a storage key that points outside blob storage", async () => {
    mockedDetail.mockResolvedValue(doc({ storageKey: "http://169.254.169.254/latest" }));
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const res = await call();

    expect(res.status).toBe(502);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("returns 502 when the storage fetch fails", async () => {
    mockedDetail.mockResolvedValue(doc());
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("nope", { status: 404 })));

    const res = await call();

    expect(res.status).toBe(502);
    expect(JSON.stringify(await res.json())).not.toContain("vercel-storage");
  });
});
