// @vitest-environment node
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import type { ParsedInvoice } from "@/services/ai/schema";
import { isProvisionalCreateEnabled, persistParseResult } from "@/services/documents/parse";
import { createTestDb, type TestDb } from "@/test/pglite";

type Line = ParsedInvoice["lineItems"][number];

const VENDOR = "山田興業株式会社";
const MAKER = "フクビ化学工業(株)";

function line(overrides: Partial<Line> = {}): Line {
  return {
    lineNo: 1,
    productMaker: MAKER,
    productName: "ウェザータイト(防水部材)",
    spec: "パイプ用 150φ WTP150 □255mm",
    quantity: 2,
    unitPrice: 383,
    amount: 766,
    confidence: 0.95,
    ...overrides,
  };
}

function invoice(lineItems: Line[], overrides: Partial<ParsedInvoice> = {}): ParsedInvoice {
  return { vendorName: VENDOR, invoiceDate: "2026-11-04", lineItems, ...overrides };
}

let t: TestDb;

async function addDocument(fileName = "納品書1.pdf", pageNumber = 1): Promise<string> {
  const [row] = await t.rows<{ document_id: string }>(
    `INSERT INTO documents (file_name, file_hash, storage_key, page_number, page_total)
     VALUES ($1, 'hash', 'documents/x.pdf', $2, 1) RETURNING document_id`,
    [fileName, pageNumber],
  );
  return row.document_id;
}

async function parse(
  documentId: string,
  data: ParsedInvoice,
  provisionalCreateEnabled = true,
): Promise<string> {
  const [run] = await t.rows<{ parse_run_id: string }>(
    `INSERT INTO document_parse_runs (document_id, status, model, prompt_version)
     VALUES ($1, 'RUNNING', 'test', 'test') RETURNING parse_run_id`,
    [documentId],
  );
  await persistParseResult(t.db, {
    documentId,
    parseRunId: run.parse_run_id,
    invoiceData: data,
    provisionalCreateEnabled,
  });
  return run.parse_run_id;
}

async function addProduct(input: {
  key: string;
  name: string;
  spec?: string | null;
  maker?: string | null;
  status?: string;
  mergedInto?: string | null;
}): Promise<string> {
  const [row] = await t.rows<{ product_id: string }>(
    `INSERT INTO product_master
       (product_key, product_name, spec, product_maker, review_status, merged_into_product_id)
     VALUES ($1, $2, $3, $4, $5, $6) RETURNING product_id`,
    [
      input.key,
      input.name,
      input.spec ?? null,
      input.maker ?? null,
      input.status ?? "LEGACY",
      input.mergedInto ?? null,
    ],
  );
  return row.product_id;
}

const products = () =>
  t.rows<{
    product_id: string;
    product_key: string;
    product_name: string;
    spec: string | null;
    category: string | null;
    review_status: string;
  }>(`SELECT * FROM product_master ORDER BY product_key`);
const prices = () =>
  t.rows<{ product_id: string; vendor_name: string; unit_price: string }>(
    `SELECT * FROM vendor_prices ORDER BY vendor_name`,
  );
const sources = () =>
  t.rows<{
    line_item_id: string;
    product_id: string;
    link_method: string;
    linked_by: string;
    attention_reason: string | null;
  }>(`SELECT * FROM product_document_sources ORDER BY linked_at, line_item_id`);
const diffs = (parseRunId: string) =>
  t.rows<{ classification: string; reason: string | null; after: Record<string, unknown> }>(
    `SELECT d.classification, d.reason, d.after
       FROM document_diff_items d
       JOIN document_line_items li ON li.line_item_id = d.line_item_id
      WHERE d.parse_run_id = $1 ORDER BY li.line_no`,
    [parseRunId],
  );
const count = async (table: string) =>
  Number((await t.rows<{ n: string }>(`SELECT count(*) AS n FROM ${table}`))[0].n);

beforeAll(async () => {
  t = await createTestDb();
}, 60_000);

afterAll(async () => {
  await t.close();
});

beforeEach(async () => {
  await t.reset();
});

describe("isProvisionalCreateEnabled", () => {
  it("is off unless explicitly enabled", () => {
    expect(isProvisionalCreateEnabled(undefined)).toBe(false);
    expect(isProvisionalCreateEnabled("")).toBe(false);
    expect(isProvisionalCreateEnabled("0")).toBe(false);
    expect(isProvisionalCreateEnabled("1")).toBe(true);
    expect(isProvisionalCreateEnabled(" TRUE ")).toBe(true);
  });
});

describe("persistParseResult with provisional creation disabled", () => {
  it("keeps the previous behaviour: a new candidate diff and no product", async () => {
    const doc = await addDocument();
    const run = await parse(doc, invoice([line()]), false);

    expect(await products()).toHaveLength(0);
    expect(await sources()).toHaveLength(0);
    expect(await diffs(run)).toMatchObject([
      { classification: "NEW_CANDIDATE", reason: "REVIEW_REQUIRED_BEFORE_PRODUCT_CREATE" },
    ]);
  });

  it("stores the extracted maker on the line item", async () => {
    const doc = await addDocument();
    await parse(doc, invoice([line()]), false);
    const [item] = await t.rows<{ product_maker: string | null }>(
      `SELECT product_maker FROM document_line_items`,
    );
    expect(item.product_maker).toBe(MAKER);
  });
});

describe("persistParseResult with provisional creation enabled", () => {
  it("creates an unverified product with its price, source and history", async () => {
    const doc = await addDocument();
    const run = await parse(doc, invoice([line()]));

    const [product] = await products();
    expect(product).toMatchObject({
      product_key: `${MAKER}｜ウェザータイト(防水部材)｜パイプ用 150φ WTP150 □255mm`,
      review_status: "PROVISIONAL",
      category: null,
    });
    expect(await prices()).toMatchObject([
      { product_id: product.product_id, vendor_name: VENDOR, unit_price: "383.00" },
    ]);
    expect(await sources()).toMatchObject([
      {
        product_id: product.product_id,
        link_method: "PROVISIONAL_CREATE",
        linked_by: "system:pdf-parse",
        attention_reason: null,
      },
    ]);

    const history = await t.rows<{
      action: string;
      reviewed_by: string;
      source_line_item_id: string;
      after_snapshot: Record<string, unknown>;
    }>(`SELECT * FROM product_review_history`);
    expect(history).toHaveLength(1);
    expect(history[0]).toMatchObject({
      action: "PROVISIONAL_CREATE",
      reviewed_by: "system:pdf-parse",
    });
    expect(history[0].after_snapshot).toMatchObject({
      reviewStatus: "PROVISIONAL",
      unitPrice: "383.00",
    });
    expect(history[0].source_line_item_id).toBe((await sources())[0].line_item_id);

    expect(await count("update_history")).toBe(1);
    expect(await diffs(run)).toMatchObject([
      { classification: "UPDATE", reason: "PROVISIONAL_PRODUCT_CREATED" },
    ]);
    const [item] = await t.rows<{ matched_product_id: string }>(
      `SELECT matched_product_id FROM document_line_items`,
    );
    expect(item.matched_product_id).toBe(product.product_id);
  });

  it("does not duplicate anything when the same document is parsed again", async () => {
    const doc = await addDocument();
    await parse(doc, invoice([line()]));
    const run2 = await parse(doc, invoice([line()]));

    expect(await products()).toHaveLength(1);
    expect((await products())[0].review_status).toBe("PROVISIONAL");
    expect(await prices()).toHaveLength(1);
    expect(await count("product_review_history")).toBe(1);
    expect(await count("update_history")).toBe(1);

    // 出典は増やさず、最新の解析の明細へ付け替える。
    const all = await sources();
    expect(all).toHaveLength(1);
    expect(all[0].link_method).toBe("PROVISIONAL_CREATE");
    const [latest] = await t.rows<{ line_item_id: string }>(
      `SELECT line_item_id FROM document_line_items WHERE parse_run_id = $1`,
      [run2],
    );
    expect(all[0].line_item_id).toBe(latest.line_item_id);
    expect(await diffs(run2)).toMatchObject([
      { classification: "NO_CHANGE", reason: "LINKED_TO_UNVERIFIED_PRODUCT" },
    ]);
  });

  it("adds a second source from another document without overwriting the price or verifying", async () => {
    await parse(await addDocument("納品書1.pdf"), invoice([line()]));
    const run2 = await parse(
      await addDocument("納品書3.pdf"),
      invoice([line({ unitPrice: 400, amount: 800 })], { invoiceDate: "2026-12-01" }),
    );

    const [product] = await products();
    expect(await products()).toHaveLength(1);
    expect(product.review_status).toBe("PROVISIONAL");
    expect(await prices()).toMatchObject([{ unit_price: "383.00" }]);

    const all = await sources();
    expect(all.map((s) => s.link_method)).toEqual(["PROVISIONAL_CREATE", "EXACT_MATCH"]);
    expect(all[1].attention_reason).toBe("登録済みの単価と相違");
    expect(await diffs(run2)).toMatchObject([
      { classification: "BLOCKED", reason: "UNVERIFIED_PRODUCT_PRICE_CONFLICT" },
    ]);
    expect(await count("update_history")).toBe(1);
  });

  it("adds a price for a new vendor but keeps the product unverified", async () => {
    await parse(await addDocument("納品書1.pdf"), invoice([line()]));
    const run2 = await parse(
      await addDocument("納品書3.pdf"),
      invoice([line({ unitPrice: 390, amount: 780 })], { vendorName: "別の商事" }),
    );

    expect((await products())[0].review_status).toBe("PROVISIONAL");
    expect((await prices()).map((p) => [p.vendor_name, p.unit_price])).toEqual([
      ["別の商事", "390.00"],
      [VENDOR, "383.00"],
    ]);
    expect(await diffs(run2)).toMatchObject([
      { classification: "UPDATE", reason: "UNVERIFIED_PRODUCT_PRICE_ADDED" },
    ]);
    expect(await count("update_history")).toBe(2);
  });

  it("keeps products with a different size apart", async () => {
    const doc = await addDocument();
    await parse(doc, invoice([line(), line({ lineNo: 2, spec: "パイプ用 100φ WTP100 □205mm" })]));
    expect((await products()).map((p) => p.spec)).toEqual([
      "パイプ用 100φ WTP100 □205mm",
      "パイプ用 150φ WTP150 □255mm",
    ]);
  });

  it("links repeated lines in one parse to a single product", async () => {
    const doc = await addDocument();
    await parse(doc, invoice([line(), line({ lineNo: 2 })]));

    expect(await products()).toHaveLength(1);
    expect(await prices()).toHaveLength(1);
    expect((await sources()).map((s) => s.link_method).sort()).toEqual([
      "EXACT_MATCH",
      "PROVISIONAL_CREATE",
    ]);
    expect(await count("product_review_history")).toBe(1);
  });

  it("creates a product without a price row when the price is missing", async () => {
    const doc = await addDocument();
    await parse(doc, invoice([line({ unitPrice: null, quantity: null, amount: null })]));

    expect(await products()).toHaveLength(1);
    expect(await prices()).toHaveLength(0);
    expect((await sources())[0].attention_reason).toBe("単価なし");
    expect(await count("update_history")).toBe(0);
  });

  it("leaves low-confidence lines unmatched instead of creating a product", async () => {
    const doc = await addDocument();
    const run = await parse(doc, invoice([line({ confidence: 0.5 })]));

    expect(await products()).toHaveLength(0);
    expect(await sources()).toHaveLength(0);
    expect(await diffs(run)).toMatchObject([
      { classification: "UNMATCHED", reason: "NO_PRODUCT_MATCH" },
    ]);
  });

  it("does not revert a manual correction when the document is parsed again", async () => {
    const doc = await addDocument();
    await parse(doc, invoice([line()]));
    const [created] = await products();
    await t.rows(
      `UPDATE product_master
          SET product_name = '手動修正した品名', spec = '手動修正した規格', product_key = '手動修正キー'
        WHERE product_id = $1`,
      [created.product_id],
    );

    await parse(doc, invoice([line()]));

    const all = await products();
    expect(all).toHaveLength(1);
    expect(all[0]).toMatchObject({
      product_id: created.product_id,
      product_name: "手動修正した品名",
      spec: "手動修正した規格",
      review_status: "PROVISIONAL",
    });
    expect(await sources()).toHaveLength(1);
  });

  it("never reuses or recreates a merged product; it points to the merge target", async () => {
    const key = `${MAKER}｜ウェザータイト(防水部材)｜パイプ用 150φ WTP150 □255mm`;
    const target = await addProduct({ key: "統合先キー", name: "統合先", status: "VERIFIED" });
    const merged = await addProduct({
      key,
      name: "統合元",
      status: "MERGED",
      mergedInto: target,
    });

    const run = await parse(await addDocument(), invoice([line()]));

    expect(await products()).toHaveLength(2);
    expect(await sources()).toHaveLength(0);
    expect(await prices()).toHaveLength(0);
    const [diff] = await diffs(run);
    expect(diff).toMatchObject({ classification: "UNMATCHED", reason: "MATCHES_MERGED_PRODUCT" });
    expect(diff.after).toMatchObject({ mergedProductId: merged, mergeTargetProductId: target });
  });

  it("follows a source that was re-pointed by a merge when the document is parsed again", async () => {
    const doc = await addDocument();
    await parse(doc, invoice([line()]));
    const [provisional] = await products();
    const target = await addProduct({ key: "統合先キー", name: "統合先", status: "VERIFIED" });
    // 人による統合を再現: 出典を統合先へ付け替え、統合元を MERGED にする。
    await t.rows(`UPDATE product_document_sources SET product_id = $1`, [target]);
    await t.rows(`DELETE FROM vendor_prices WHERE product_id = $1`, [provisional.product_id]);
    await t.rows(
      `UPDATE product_master SET review_status = 'MERGED', merged_into_product_id = $1
        WHERE product_id = $2`,
      [target, provisional.product_id],
    );

    const run2 = await parse(doc, invoice([line()]));

    expect(await products()).toHaveLength(2);
    const all = await sources();
    expect(all).toHaveLength(1);
    expect(all[0].product_id).toBe(target);
    const [item] = await t.rows<{ matched_product_id: string }>(
      `SELECT matched_product_id FROM document_line_items WHERE parse_run_id = $1`,
      [run2],
    );
    expect(item.matched_product_id).toBe(target);
  });

  it("does not match a legacy key when the makers contradict each other", async () => {
    await addProduct({
      key: "ウェザータイト(防水部材)｜パイプ用 150φ WTP150 □255mm",
      name: "ウェザータイト(防水部材)",
      spec: "パイプ用 150φ WTP150 □255mm",
      maker: "別メーカー(株)",
    });

    await parse(await addDocument(), invoice([line()]));

    const all = await products();
    expect(all).toHaveLength(2);
    expect(all.map((p) => p.review_status).sort()).toEqual(["LEGACY", "PROVISIONAL"]);
  });

  it("keeps the normal update rules for existing products and records the source", async () => {
    const existing = await addProduct({
      key: `${MAKER}｜ウェザータイト(防水部材)｜パイプ用 150φ WTP150 □255mm`,
      name: "ウェザータイト(防水部材)",
      spec: "パイプ用 150φ WTP150 □255mm",
      maker: MAKER,
    });

    const run = await parse(await addDocument(), invoice([line()]));

    expect(await products()).toHaveLength(1);
    expect((await products())[0].review_status).toBe("LEGACY");
    expect(await prices()).toMatchObject([{ product_id: existing, unit_price: "383.00" }]);
    expect(await sources()).toMatchObject([
      { product_id: existing, link_method: "EXACT_MATCH", attention_reason: null },
    ]);
    expect(await count("product_review_history")).toBe(0);
    expect(await diffs(run)).toMatchObject([{ classification: "UPDATE" }]);
  });

  it("rolls everything back when saving fails part-way", async () => {
    const doc = await addDocument();
    // 行番号の重複は明細の一意制約に違反する（商品作成の後で失敗する）。
    await expect(
      parse(doc, invoice([line(), line({ lineNo: 1, spec: "別規格" })])),
    ).rejects.toThrow();

    expect(await products()).toHaveLength(0);
    expect(await sources()).toHaveLength(0);
    expect(await prices()).toHaveLength(0);
    expect(await count("document_line_items")).toBe(0);
    expect(await count("product_review_history")).toBe(0);
  });
});
