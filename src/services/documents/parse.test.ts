import { describe, expect, it, vi } from "vitest";
import { documentDiffItems, documentLineItems, documents, productMaster, vendorPrices } from "@/db/schema";
import { parseDocument } from "@/services/documents/parse";

const parseInvoiceFromPdf = vi.fn();

vi.mock("@/services/ai/gemini", () => ({
  parseInvoiceFromPdf: (pdfBase64: string) => parseInvoiceFromPdf(pdfBase64),
}));

vi.mock("@/services/storage", () => ({
  getStorageProvider: () => ({
    getDownloadUrl: async () => "http://example.com/test.pdf",
  }),
}));

vi.mock("@/config/env", () => ({
  getEnv: () => ({
    GEMINI_MODEL: "gemini-test",
  }),
}));

type InsertCall = { table: unknown; values: unknown };
type UpdateCall = { table: unknown; values: unknown };

function createWhereResult(rows: unknown[]) {
  return {
    limit: async (n: number) => rows.slice(0, n),
    orderBy: async () => rows,
    then: (resolve: (value: unknown[]) => void) => Promise.resolve(rows).then(resolve),
  };
}

function createSelect(rowsByTable: Map<unknown, unknown[]>) {
  return () => ({
    from: (table: unknown) => ({
      where: () => createWhereResult(rowsByTable.get(table) ?? []),
    }),
  });
}

function createDbMock() {
  const insertCalls: InsertCall[] = [];
  const updateCalls: UpdateCall[] = [];

  const rowsByTable = new Map<unknown, unknown[]>([
    [
      documents,
      [
        {
          documentId: "doc-1",
          storageKey: "storage-key",
          isDeleted: false,
        },
      ],
    ],
    [
      productMaster,
      [
        {
          productId: "prod-1",
          productKey: "Widget｜Spec",
          productName: "Widget",
          spec: "Spec",
          defaultUnitPrice: "8.00",
          qualityFlag: "OK",
          category: null,
        },
      ],
    ],
    [
      vendorPrices,
      [
        {
          vendorPriceId: "vp-1",
          productId: "prod-1",
          unitPrice: "8.00",
          priceUpdatedOn: "2024-01-01",
        },
      ],
    ],
  ]);

  const tx = {
    select: createSelect(rowsByTable),
    insert: (table: unknown) => ({
      values: (values: unknown) => {
        insertCalls.push({ table, values });
        return {
          onConflictDoUpdate: () => ({
            returning: async () => rowsByTable.get(productMaster) ?? [],
          }),
          then: (resolve: (value: unknown) => void) => Promise.resolve().then(resolve),
        };
      },
    }),
    update: (table: unknown) => ({
      set: (values: unknown) => ({
        where: async () => {
          updateCalls.push({ table, values });
        },
      }),
    }),
  };

  return {
    select: createSelect(rowsByTable),
    transaction: async (callback: (tx: typeof tx) => Promise<void>) => {
      await callback(tx);
    },
    insertCalls,
    updateCalls,
  };
}

const dbMock = createDbMock();

vi.mock("@/db/client", () => ({
  getDb: () => dbMock,
}));

describe("parseDocument", () => {
  it("persists numeric strings and creates diff rows", async () => {
    parseInvoiceFromPdf.mockResolvedValue({
      vendorName: "Vendor",
      invoiceDate: "2024-02-01",
      lineItems: [
        {
          lineNo: 1,
          productName: "Widget",
          spec: "Spec",
          quantity: 2,
          unitPrice: 10,
          amount: 20,
          confidence: 0.95,
        },
      ],
    });

    globalThis.fetch = vi.fn(async () => new Response(new Uint8Array([1, 2, 3]), { status: 200 }));

    await parseDocument("doc-1");

    const lineItemInsert = dbMock.insertCalls.find((call: InsertCall) => call.table === documentLineItems);
    const diffInsert = dbMock.insertCalls.find((call: InsertCall) => call.table === documentDiffItems);
    const vendorUpdate = dbMock.updateCalls.find((call: UpdateCall) => call.table === vendorPrices);

    expect(lineItemInsert).toBeTruthy();
    const lineItemRows = lineItemInsert?.values as Array<{ unitPrice: string | null; quantity: string | null }>;
    expect(lineItemRows[0].unitPrice).toBe("10.00");
    expect(lineItemRows[0].quantity).toBe("2.000");

    expect(diffInsert).toBeTruthy();

    expect(vendorUpdate).toBeTruthy();
    const vendorUpdateValues = vendorUpdate?.values as { unitPrice?: string };
    expect(vendorUpdateValues.unitPrice).toBe("10.00");
  });
});
