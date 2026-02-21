import { beforeEach, describe, expect, it, vi } from "vitest";

const state = {
  failFirstSelect: false,
  selectCalls: 0,
};

type FakeSelect = {
  from: () => {
    where: () => {
      orderBy: () => Promise<
        Array<{
          documentId: string;
          fileName: string;
          uploadedAt: Date;
          status: string;
          vendorName: string | null;
          invoiceDate: string | null;
          uploadNote: string | null;
          uploadGroupId: string | null;
          pageNumber: number | null;
          pageTotal: number | null;
          sourceFileHash: string | null;
        }>
      >;
    };
  };
};

vi.mock("@/db/client", () => ({
  getDb: () => ({
    select: () => {
      state.selectCalls += 1;
      return {
        from: () => ({
          where: () => ({
            orderBy: async () => {
              if (state.failFirstSelect && state.selectCalls === 1) {
                const error = new Error("column does not exist") as Error & { code?: string };
                error.code = "42703";
                throw error;
              }
              return [
                {
                  documentId: "doc-1",
                  fileName: "invoice.pdf",
                  uploadedAt: new Date("2026-02-21T00:00:00Z"),
                  status: "UPLOADED",
                  vendorName: null,
                  invoiceDate: null,
                  uploadNote: null,
                  uploadGroupId: null,
                  pageNumber: null,
                  pageTotal: null,
                  sourceFileHash: null,
                },
              ];
            },
          }),
        }),
      } satisfies FakeSelect;
    },
  }),
}));

import { listDocuments } from "@/services/documents/repository";

describe("listDocuments", () => {
  beforeEach(() => {
    state.failFirstSelect = false;
    state.selectCalls = 0;
  });

  it("returns documents with page metadata when schema is up to date", async () => {
    const rows = await listDocuments();
    expect(rows).toHaveLength(1);
    expect(rows[0].fileName).toBe("invoice.pdf");
  });

  it("falls back to legacy query when page metadata columns are missing", async () => {
    state.failFirstSelect = true;
    const rows = await listDocuments();
    expect(rows).toHaveLength(1);
    expect(rows[0].uploadGroupId).toBeNull();
    expect(rows[0].pageNumber).toBeNull();
  });
});
