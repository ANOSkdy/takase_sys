// @vitest-environment node
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { findSimilarProductsFor } from "@/services/products/candidates";
import {
  applyReviewAction,
  reviewActionSchema,
  type ReviewActionInput,
} from "@/services/products/review";
import { createTestDb, type TestDb } from "@/test/pglite";

let t: TestDb;

const MAKER = "フクビ化学工業(株)";
const NAME = "ウェザータイト(防水部材)";
const SPEC = "パイプ用 150φ WTP150 □255mm";

type ProductRow = {
  product_id: string;
  product_key: string;
  product_name: string;
  product_maker: string | null;
  spec: string | null;
  category: string | null;
  review_status: string;
  reviewed_by: string | null;
  merged_into_product_id: string | null;
  last_updated_at: Date;
};

async function addProduct(
  input: Partial<{
    key: string;
    name: string;
    maker: string | null;
    spec: string | null;
    status: string;
  }> = {},
): Promise<string> {
  const name = input.name ?? NAME;
  const spec = input.spec === undefined ? SPEC : input.spec;
  const maker = input.maker === undefined ? MAKER : input.maker;
  const [row] = await t.rows<{ product_id: string }>(
    `INSERT INTO product_master (product_key, product_name, product_maker, spec, review_status)
     VALUES ($1, $2, $3, $4, $5) RETURNING product_id`,
    [
      input.key ?? [maker, name, spec].filter(Boolean).join("｜"),
      name,
      maker,
      spec,
      input.status ?? "PROVISIONAL",
    ],
  );
  return row.product_id;
}

async function addPrice(
  productId: string,
  vendorName: string,
  unitPrice: number,
  on = "2026-11-04",
) {
  const [row] = await t.rows<{ vendor_price_id: string }>(
    `INSERT INTO vendor_prices (product_id, vendor_name, unit_price, price_updated_on, source_type, source_id)
     VALUES ($1, $2, $3, $4, 'PDF', 'seed') RETURNING vendor_price_id`,
    [productId, vendorName, unitPrice, on],
  );
  return row.vendor_price_id;
}

async function addSource(productId: string): Promise<string> {
  const [doc] = await t.rows<{ document_id: string }>(
    `INSERT INTO documents (file_name, file_hash, storage_key) VALUES ('納品書1.pdf', 'h', 'k')
     RETURNING document_id`,
  );
  const [run] = await t.rows<{ parse_run_id: string }>(
    `INSERT INTO document_parse_runs (document_id, status, model, prompt_version)
     VALUES ($1, 'SUCCEEDED', 't', 't') RETURNING parse_run_id`,
    [doc.document_id],
  );
  const [item] = await t.rows<{ line_item_id: string }>(
    `INSERT INTO document_line_items (parse_run_id, line_no, product_name_raw)
     VALUES ($1, 1, '品名') RETURNING line_item_id`,
    [run.parse_run_id],
  );
  await t.rows(
    `INSERT INTO product_document_sources (line_item_id, product_id, link_method)
     VALUES ($1, $2, 'PROVISIONAL_CREATE')`,
    [item.line_item_id, productId],
  );
  return item.line_item_id;
}

async function getProduct(productId: string): Promise<ProductRow> {
  const [row] = await t.rows<ProductRow>(`SELECT * FROM product_master WHERE product_id = $1`, [
    productId,
  ]);
  return row;
}

const token = async (productId: string) =>
  (await getProduct(productId)).last_updated_at.toISOString();

const history = () =>
  t.rows<{
    action: string;
    product_id: string;
    target_product_id: string | null;
    note: string | null;
    reviewed_by: string;
    before_snapshot: Record<string, unknown>;
    after_snapshot: Record<string, unknown>;
  }>(`SELECT * FROM product_review_history ORDER BY reviewed_at`);

const prices = (productId: string) =>
  t.rows<{ vendor_name: string; unit_price: string; price_updated_on: string }>(
    `SELECT vendor_name, unit_price, price_updated_on::text FROM vendor_prices
      WHERE product_id = $1 ORDER BY vendor_name`,
    [productId],
  );

const count = async (table: string) =>
  Number((await t.rows<{ n: string }>(`SELECT count(*) AS n FROM ${table}`))[0].n);

function act(productId: string, input: Record<string, unknown>) {
  const parsed = reviewActionSchema.parse({ reviewedBy: "高瀬", ...input }) as ReviewActionInput;
  return applyReviewAction(t.db, productId, parsed);
}

beforeAll(async () => {
  t = await createTestDb();
}, 60_000);

afterAll(async () => {
  await t.close();
});

beforeEach(async () => {
  await t.reset();
});

describe("reviewActionSchema", () => {
  it("requires a reviewer name", () => {
    const result = reviewActionSchema.safeParse({
      action: "VERIFY",
      reviewedBy: "  ",
      expectedUpdatedAt: "x",
    });
    expect(result.success).toBe(false);
  });
});

describe("VERIFY", () => {
  it("marks the product verified and records who confirmed it", async () => {
    const id = await addProduct();
    const result = await act(id, { action: "VERIFY", expectedUpdatedAt: await token(id) });

    expect(result).toMatchObject({ ok: true, reviewStatus: "VERIFIED" });
    expect(await getProduct(id)).toMatchObject({ review_status: "VERIFIED", reviewed_by: "高瀬" });
    expect(await history()).toMatchObject([{ action: "VERIFY", reviewed_by: "高瀬" }]);
  });

  it("does nothing on a second submission with the same token (double click)", async () => {
    const id = await addProduct();
    const expectedUpdatedAt = await token(id);
    await act(id, { action: "VERIFY", expectedUpdatedAt });
    // 別ミリ秒になるのを待たず、状態チェックでも止まることを確認する。
    const second = await act(id, { action: "VERIFY", expectedUpdatedAt });

    expect(second.ok).toBe(false);
    expect(await count("product_review_history")).toBe(1);
  });

  it("rejects a stale token", async () => {
    const id = await addProduct();
    const result = await act(id, {
      action: "VERIFY",
      expectedUpdatedAt: "2000-01-01T00:00:00.000Z",
    });
    expect(result).toMatchObject({ ok: false, code: "STALE" });
    expect((await getProduct(id)).review_status).toBe("PROVISIONAL");
    expect(await count("product_review_history")).toBe(0);
  });
});

describe("REQUEST_REVIEW", () => {
  it("moves a verified product back to needs-review with the reason", async () => {
    const id = await addProduct({ status: "VERIFIED" });
    const result = await act(id, {
      action: "REQUEST_REVIEW",
      expectedUpdatedAt: await token(id),
      reason: "単価が古い",
    });

    expect(result).toMatchObject({ ok: true, reviewStatus: "NEEDS_REVIEW" });
    expect(await history()).toMatchObject([{ action: "REQUEST_REVIEW", note: "単価が古い" }]);
  });
});

describe("CORRECT", () => {
  it("updates the product and its key but does not verify it", async () => {
    const id = await addProduct();
    const priceId = await addPrice(id, "山田興業株式会社", 383);

    const result = await act(id, {
      action: "CORRECT",
      expectedUpdatedAt: await token(id),
      productName: NAME,
      productMaker: MAKER,
      spec: "パイプ用 150φ WTP150 □260mm",
      category: "防水部材",
      prices: [{ vendorPriceId: priceId, unitPrice: 390 }],
    });

    expect(result).toMatchObject({ ok: true, reviewStatus: "PROVISIONAL" });
    expect(await getProduct(id)).toMatchObject({
      review_status: "PROVISIONAL",
      spec: "パイプ用 150φ WTP150 □260mm",
      category: "防水部材",
      product_key: `${MAKER}｜${NAME}｜パイプ用 150φ WTP150 □260mm`,
    });
    expect(await prices(id)).toMatchObject([{ unit_price: "390.00" }]);

    const [entry] = await history();
    expect(entry.action).toBe("CORRECT");
    expect(entry.before_snapshot).toMatchObject({ spec: SPEC });
    expect(entry.after_snapshot).toMatchObject({ spec: "パイプ用 150φ WTP150 □260mm" });
    const updates = await t.rows<{ before_value: string; after_value: string; updated_by: string }>(
      `SELECT before_value, after_value, updated_by FROM update_history`,
    );
    expect(updates).toMatchObject([
      { before_value: "383.00", after_value: "390.00", updated_by: "高瀬" },
    ]);
  });

  it("refuses a correction that would duplicate another product and suggests merging", async () => {
    const other = await addProduct({ spec: "別規格", status: "VERIFIED" });
    const id = await addProduct();

    const result = await act(id, {
      action: "CORRECT",
      expectedUpdatedAt: await token(id),
      productName: NAME,
      productMaker: MAKER,
      spec: "別規格",
    });

    expect(result).toMatchObject({ ok: false, code: "KEY_CONFLICT", conflictingProductId: other });
    expect((await getProduct(id)).spec).toBe(SPEC);
    expect(await count("product_review_history")).toBe(0);
  });

  it("reports when nothing changed", async () => {
    const id = await addProduct();
    const result = await act(id, {
      action: "CORRECT",
      expectedUpdatedAt: await token(id),
      productName: NAME,
      productMaker: MAKER,
      spec: SPEC,
    });
    expect(result).toMatchObject({ ok: false, code: "NO_CHANGE" });
  });
});

describe("MERGE", () => {
  async function setup() {
    const target = await addProduct({
      key: "統合先",
      maker: "フクビ化学工業（株）",
      status: "VERIFIED",
    });
    const source = await addProduct();
    return { source, target };
  }

  it("moves sources and prices, keeps the merged row, and leaves the target's status alone", async () => {
    const { source, target } = await setup();
    const lineItemId = await addSource(source);
    await addPrice(source, "山田興業株式会社", 383);

    const result = await act(source, {
      action: "MERGE",
      expectedUpdatedAt: await token(source),
      targetProductId: target,
      targetExpectedUpdatedAt: await token(target),
    });

    expect(result).toMatchObject({ ok: true, reviewStatus: "MERGED", mergedIntoProductId: target });
    expect(await getProduct(source)).toMatchObject({
      review_status: "MERGED",
      merged_into_product_id: target,
    });
    expect((await getProduct(target)).review_status).toBe("VERIFIED");
    expect(await prices(source)).toHaveLength(0);
    expect(await prices(target)).toMatchObject([
      { vendor_name: "山田興業株式会社", unit_price: "383.00" },
    ]);
    const [src] = await t.rows<{ product_id: string; line_item_id: string }>(
      `SELECT * FROM product_document_sources`,
    );
    expect(src).toMatchObject({ product_id: target, line_item_id: lineItemId });

    const [entry] = await history();
    expect(entry).toMatchObject({ action: "MERGE", product_id: source, target_product_id: target });
    expect(entry.before_snapshot).toMatchObject({ sourceLineItemIds: [lineItemId] });
  });

  it("requires a choice when the same vendor has a different price, and writes nothing until then", async () => {
    const { source, target } = await setup();
    await addPrice(source, "山田興業株式会社", 400, "2026-12-01");
    await addPrice(target, "山田興業株式会社", 383, "2026-11-04");
    const base = {
      action: "MERGE",
      targetProductId: target,
      expectedUpdatedAt: await token(source),
      targetExpectedUpdatedAt: await token(target),
    };

    const blocked = await act(source, base);
    expect(blocked).toMatchObject({
      ok: false,
      code: "PRICE_CHOICE_REQUIRED",
      priceConflicts: [
        {
          vendorName: "山田興業株式会社",
          sourceUnitPrice: "400.00",
          sourcePriceUpdatedOn: "2026-12-01",
          targetUnitPrice: "383.00",
          targetPriceUpdatedOn: "2026-11-04",
        },
      ],
    });
    expect((await getProduct(source)).review_status).toBe("PROVISIONAL");
    expect(await count("product_review_history")).toBe(0);

    const merged = await act(source, {
      ...base,
      priceChoices: { 山田興業株式会社: "USE_SOURCE" },
    });
    expect(merged.ok).toBe(true);
    expect(await prices(target)).toMatchObject([
      { unit_price: "400.00", price_updated_on: "2026-12-01" },
    ]);
    expect(await count("update_history")).toBe(1);
  });

  it("keeps the target's price when the user chooses to", async () => {
    const { source, target } = await setup();
    await addPrice(source, "山田興業株式会社", 400);
    await addPrice(target, "山田興業株式会社", 383);

    await act(source, {
      action: "MERGE",
      targetProductId: target,
      expectedUpdatedAt: await token(source),
      targetExpectedUpdatedAt: await token(target),
      priceChoices: { 山田興業株式会社: "KEEP_TARGET" },
    });

    expect(await prices(target)).toMatchObject([{ unit_price: "383.00" }]);
    expect(await count("update_history")).toBe(0);
    expect(await count("vendor_prices")).toBe(1);
  });

  it("rejects self, unverified and merged targets", async () => {
    const { source, target } = await setup();
    const provisional = await addProduct({ spec: "別規格A" });
    const merged = await addProduct({ spec: "別規格B" });
    await t.rows(
      `UPDATE product_master SET review_status = 'MERGED', merged_into_product_id = $1
        WHERE product_id = $2`,
      [target, merged],
    );

    for (const targetProductId of [source, provisional, merged]) {
      const result = await act(source, {
        action: "MERGE",
        targetProductId,
        expectedUpdatedAt: await token(source),
        targetExpectedUpdatedAt: await token(targetProductId),
      });
      expect(result).toMatchObject({ ok: false, code: "INVALID_TARGET" });
    }
    expect((await getProduct(source)).review_status).toBe("PROVISIONAL");
  });

  it("refuses to merge when the target changed after the candidates were shown", async () => {
    const { source, target } = await setup();
    const staleTargetToken = await token(target);
    await t.rows(
      `UPDATE product_master SET spec = '更新後', last_updated_at = now() + interval '1 second'
        WHERE product_id = $1`,
      [target],
    );

    const result = await act(source, {
      action: "MERGE",
      targetProductId: target,
      expectedUpdatedAt: await token(source),
      targetExpectedUpdatedAt: staleTargetToken,
    });

    expect(result).toMatchObject({ ok: false, code: "STALE" });
    expect((await getProduct(source)).review_status).toBe("PROVISIONAL");
  });

  it("cannot operate on a merged product, and re-points earlier merges to the final target", async () => {
    const { source, target } = await setup();
    const earlier = await addProduct({ spec: "別規格C" });
    await t.rows(
      `UPDATE product_master SET review_status = 'MERGED', merged_into_product_id = $1
        WHERE product_id = $2`,
      [source, earlier],
    );

    await act(source, {
      action: "MERGE",
      targetProductId: target,
      expectedUpdatedAt: await token(source),
      targetExpectedUpdatedAt: await token(target),
    });

    expect((await getProduct(earlier)).merged_into_product_id).toBe(target);
    const again = await act(source, { action: "VERIFY", expectedUpdatedAt: await token(source) });
    expect(again).toMatchObject({ ok: false, code: "INVALID_STATE" });
  });
});

describe("findSimilarProductsFor", () => {
  it("lists candidates with matched and differing fields, excluding merged and unrelated products", async () => {
    const id = await addProduct();
    const sameOtherNotation = await addProduct({
      key: "k1",
      maker: "フクビ化学工業（株）",
      status: "VERIFIED",
    });
    const otherSize = await addProduct({
      key: "k2",
      spec: "パイプ用 100φ WTP100 □205mm",
      status: "LEGACY",
    });
    const unverified = await addProduct({ key: "k3", spec: "パイプ用 150φ WTP150" });
    await addProduct({
      key: "k4",
      name: "スリムダクト",
      maker: "因幡電機産業(株)",
      spec: "SFJ-77",
    });
    const merged = await addProduct({ key: "k5", status: "VERIFIED" });
    await t.rows(
      `UPDATE product_master SET review_status = 'MERGED', merged_into_product_id = $1
        WHERE product_id = $2`,
      [sameOtherNotation, merged],
    );

    const candidates = await findSimilarProductsFor(t.db, id);
    const byId = new Map(candidates.map((c) => [c.productId, c]));

    expect(candidates[0].productId).toBe(sameOtherNotation);
    expect(byId.get(sameOtherNotation)).toMatchObject({ mergeable: true, differingFields: [] });
    expect(byId.get(otherSize)?.differingFields).toContain(
      "口径・寸法（150φ 255mm ／ 100φ 205mm）",
    );
    expect(byId.get(unverified)).toMatchObject({ mergeable: false });
    expect(byId.has(merged)).toBe(false);
    expect(candidates).toHaveLength(3);
  });

  it("returns an empty list when nothing is similar", async () => {
    const id = await addProduct();
    await addProduct({
      key: "k4",
      name: "スリムダクト",
      maker: "因幡電機産業(株)",
      spec: "SFJ-77",
    });
    expect(await findSimilarProductsFor(t.db, id)).toEqual([]);
  });
});
