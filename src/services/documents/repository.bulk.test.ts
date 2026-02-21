import { beforeEach, describe, expect, it, vi } from "vitest";

const state = {
  committed: [] as Array<Record<string, unknown>>,
  failInsert: false,
};

vi.mock("@/db/client", () => ({
  getDb: () => ({
    transaction: async (callback: (tx: {
      insert: () => {
        values: (rows: Array<Record<string, unknown>>) => {
          returning: () => Promise<Array<{ documentId: string; pageNumber: unknown; status: string }>>;
        };
      };
    }) => Promise<unknown>) => {
      const staged: Array<Record<string, unknown>> = [];
      const tx = {
        insert: () => ({
          values: (rows: Array<Record<string, unknown>>) => ({
            returning: async () => {
              if (state.failInsert) {
                throw new Error("INSERT_FAILED");
              }
              rows.forEach((row) => staged.push(row));
              return rows.map((row, index) => ({
                documentId: `doc-${index + 1}`,
                pageNumber: row.pageNumber,
                status: "UPLOADED",
              }));
            },
          }),
        }),
      };

      const result = await callback(tx);
      state.committed = [...state.committed, ...staged];
      return result;
    },
  }),
}));

import { registerDocumentBulk } from "@/services/documents/repository";

describe("registerDocumentBulk", () => {
  beforeEach(() => {
    state.committed = [];
    state.failInsert = false;
  });

  it("creates N document rows for pages", async () => {
    const result = await registerDocumentBulk({
      fileName: "invoice.pdf",
      pages: [
        { storageKey: "k1", fileHash: "h1", pageNumber: 1, pageTotal: 2 },
        { storageKey: "k2", fileHash: "h2", pageNumber: 2, pageTotal: 2 },
      ],
    });

    expect(result.items).toHaveLength(2);
    expect(state.committed).toHaveLength(2);
  });

  it("rolls back on failure", async () => {
    state.failInsert = true;

    await expect(
      registerDocumentBulk({
        fileName: "invoice.pdf",
        pages: [{ storageKey: "k1", fileHash: "h1", pageNumber: 1, pageTotal: 1 }],
      }),
    ).rejects.toThrow("INSERT_FAILED");

    expect(state.committed).toHaveLength(0);
  });
});
