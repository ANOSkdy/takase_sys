// @vitest-environment node
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  formatMigrationReport,
  migrateProvisionalProducts,
} from "@/services/documents/provisional-migration";
import { createTestDb, type TestDb } from "@/test/pglite";

let t: TestDb;

const GROUP = "b8eb3971-2e56-4f44-a643-2312ed2ae79b";
const OTHER_GROUP = "3206a804-55dc-49a7-bc58-6cfa8e406e1f";
const VENDOR = "山田興業株式会社";
const MAKER = "フクビ化学工業(株)";
const NAME = "ウェザータイト(防水部材)";
const SPEC = "パイプ用 150φ WTP150 □255mm";
const KEY = `${MAKER}｜${NAME}｜${SPEC}`;

type LineInput = {
  lineNo?: number;
  name?: string;
  spec?: string | null;
  maker?: string | null;
  key?: string;
  unitPrice?: number | null;
  confidence?: number;
  classification?: string;
  matchedProductId?: string | null;
};

async function addDocument(
  input: { group?: string; page?: number; deleted?: boolean; fileName?: string } = {},
) {
  const [row] = await t.rows<{ document_id: string }>(
    `INSERT INTO documents
       (file_name, file_hash, storage_key, upload_group_id, page_number, page_total, is_deleted,
        status, vendor_name, invoice_date)
     VALUES ($1, 'h', 'k', $2, $3, 30, $4, $5, $6, '2026-11-04') RETURNING document_id`,
    [
      input.fileName ?? "納品書1.pdf",
      input.group ?? GROUP,
      input.page ?? 1,
      input.deleted ?? false,
      input.deleted ? "DELETED" : "PARSED",
      VENDOR,
    ],
  );
  return row.document_id;
}

async function addRun(
  documentId: string,
  lines: LineInput[],
  opts: { startedAt?: string; status?: string } = {},
) {
  const [run] = await t.rows<{ parse_run_id: string }>(
    `INSERT INTO document_parse_runs (document_id, started_at, status, model, prompt_version)
     VALUES ($1, $2, $3, 't', 't') RETURNING parse_run_id`,
    [documentId, opts.startedAt ?? "2026-11-10T00:00:00Z", opts.status ?? "SUCCEEDED"],
  );
  for (const [index, input] of lines.entries()) {
    const name = input.name ?? NAME;
    const spec = input.spec === undefined ? SPEC : input.spec;
    const maker = input.maker === undefined ? MAKER : input.maker;
    const key = input.key ?? [maker, name, spec].filter(Boolean).join("｜");
    const price = input.unitPrice === undefined ? 383 : input.unitPrice;
    const classification = input.classification ?? "NEW_CANDIDATE";
    // 過去の明細と同じく、メーカーは明細に保存せず差分の after にだけ持たせる。
    const [item] = await t.rows<{ line_item_id: string }>(
      `INSERT INTO document_line_items
         (parse_run_id, line_no, product_name_raw, spec_raw, product_key_candidate,
          quantity, unit_price, amount, system_confidence, matched_product_id)
       VALUES ($1, $2, $3, $4, $5, 1, $6, $6, $7, $8) RETURNING line_item_id`,
      [
        run.parse_run_id,
        input.lineNo ?? index + 1,
        name,
        spec,
        key,
        price,
        input.confidence ?? 1,
        input.matchedProductId ?? null,
      ],
    );
    await t.rows(
      `INSERT INTO document_diff_items
         (parse_run_id, line_item_id, classification, reason, vendor_name, invoice_date, after)
       VALUES ($1, $2, $3, $4, $5, '2026-11-04', $6)`,
      [
        run.parse_run_id,
        item.line_item_id,
        classification,
        classification === "NEW_CANDIDATE"
          ? "REVIEW_REQUIRED_BEFORE_PRODUCT_CREATE"
          : "NO_PRODUCT_MATCH",
        VENDOR,
        JSON.stringify({ productName: name, productMaker: maker, spec, unitPrice: price }),
      ],
    );
  }
  return run.parse_run_id;
}

const run = (overrides: Partial<Parameters<typeof migrateProvisionalProducts>[1]> = {}) =>
  migrateProvisionalProducts(t.db, { uploadGroupIds: [GROUP], dryRun: false, ...overrides });

const count = async (table: string) =>
  Number((await t.rows<{ n: string }>(`SELECT count(*) AS n FROM ${table}`))[0].n);

const products = () =>
  t.rows<{
    product_id: string;
    product_key: string;
    product_maker: string | null;
    review_status: string;
    category: string | null;
  }>(`SELECT * FROM product_master ORDER BY product_key`);

beforeAll(async () => {
  t = await createTestDb();
}, 60_000);

afterAll(async () => {
  await t.close();
});

beforeEach(async () => {
  await t.reset();
});

describe("migrateProvisionalProducts", () => {
  it("supports a product_master without a unique product key and remains idempotent", async () => {
    // テスト用DBは本番と同じく product_key の一意制約がない（旧来の重複キーもある）。
    await t.rows(
      `INSERT INTO product_master (product_key, product_name)
       VALUES ('legacy-duplicate', '既存'), ('legacy-duplicate', '既存')`,
    );
    await addRun(await addDocument(), [{}, {}]);

    expect((await run()).createdProducts).toHaveLength(1);
    expect((await run()).createdProducts).toHaveLength(0);
    expect(await count("product_master")).toBe(3);
    expect(await count("product_document_sources")).toBe(2);
  });

  it("reports what it would do in a dry run and leaves the database untouched", async () => {
    await addRun(await addDocument(), [{}]);

    const report = await run({ dryRun: true });

    expect(report).toMatchObject({ dryRun: true, committed: false, targetLineCount: 1 });
    expect(report.createdProducts).toHaveLength(1);
    expect(await count("product_master")).toBe(0);
    expect(await count("product_document_sources")).toBe(0);
    expect(await count("vendor_prices")).toBe(0);
    const [diff] = await t.rows<{ classification: string }>(
      `SELECT classification FROM document_diff_items`,
    );
    expect(diff.classification).toBe("NEW_CANDIDATE");
    expect(formatMigrationReport(report)).toContain("ドライラン");
  });

  it("creates provisional products with price, source and history, using the maker from the diff", async () => {
    const parseRunId = await addRun(await addDocument(), [{}]);

    const report = await run();

    expect(report.committed).toBe(true);
    const [product] = await products();
    expect(product).toMatchObject({
      product_key: KEY,
      product_maker: MAKER,
      review_status: "PROVISIONAL",
      category: null,
    });
    expect(await t.rows(`SELECT vendor_name, unit_price FROM vendor_prices`)).toMatchObject([
      { vendor_name: VENDOR, unit_price: "383.00" },
    ]);
    expect(
      await t.rows(`SELECT link_method, linked_by FROM product_document_sources`),
    ).toMatchObject([
      { link_method: "PROVISIONAL_CREATE", linked_by: "system:provisional-migration" },
    ]);
    expect(await t.rows(`SELECT action, reviewed_by FROM product_review_history`)).toMatchObject([
      { action: "PROVISIONAL_CREATE", reviewed_by: "system:provisional-migration" },
    ]);
    expect(await t.rows(`SELECT update_key FROM update_history`)).toMatchObject([
      { update_key: `${parseRunId}:${product.product_id}:unit_price` },
    ]);

    // 明細と差分は、解析時に仮登録した場合と同じ状態になる。
    const [item] = await t.rows<{ matched_product_id: string; product_maker: string }>(
      `SELECT matched_product_id, product_maker FROM document_line_items`,
    );
    expect(item).toMatchObject({ matched_product_id: product.product_id, product_maker: MAKER });
    const [diff] = await t.rows<{ classification: string; reason: string }>(
      `SELECT classification, reason FROM document_diff_items`,
    );
    expect(diff).toMatchObject({ classification: "UPDATE", reason: "PROVISIONAL_PRODUCT_CREATED" });
  });

  it("adds nothing when it is run again", async () => {
    await addRun(await addDocument(), [{}]);
    await run();

    const second = await run();

    expect(second).toMatchObject({
      committed: true,
      targetLineCount: 0,
      alreadyMigratedLineCount: 1,
    });
    expect(second.createdProducts).toHaveLength(0);
    expect(await count("product_master")).toBe(1);
    expect(await count("vendor_prices")).toBe(1);
    expect(await count("product_document_sources")).toBe(1);
    expect(await count("product_review_history")).toBe(1);
    expect(await count("update_history")).toBe(1);
  });

  it("collapses lines with the same key into one product and keeps different sizes apart", async () => {
    await addRun(await addDocument({ page: 1 }), [{}, { spec: "パイプ用 100φ WTP100 □205mm" }]);
    await addRun(await addDocument({ page: 2 }), [{ unitPrice: 400 }]);

    const report = await run();

    expect(report.targetLineCount).toBe(3);
    expect(report.createdProducts).toHaveLength(2);
    expect(report.linkedLines).toHaveLength(1);
    // 同じ仕入先で単価が違う明細は、登録済みの単価を上書きしない。
    expect(report.priceConflicts).toMatchObject([
      { pageNumber: 2, existingUnitPrice: "383.00", extractedUnitPrice: "400.00" },
    ]);
    expect(await count("product_master")).toBe(2);
    expect(await count("product_document_sources")).toBe(3);
    const blocked = await t.rows(
      `SELECT 1 FROM document_diff_items WHERE classification = 'BLOCKED'
          AND reason = 'UNVERIFIED_PRODUCT_PRICE_CONFLICT'`,
    );
    expect(blocked).toHaveLength(1);
  });

  it("only uses the latest successful parse of documents that are not deleted, in the given groups", async () => {
    const doc = await addDocument({ page: 1 });
    await addRun(doc, [{ spec: "古い解析の規格" }], { startedAt: "2026-11-01T00:00:00Z" });
    await addRun(doc, [{}], { startedAt: "2026-11-10T00:00:00Z" });
    await addRun(doc, [{ spec: "失敗した解析の規格" }], {
      startedAt: "2026-11-11T00:00:00Z",
      status: "FAILED",
    });
    await addRun(await addDocument({ page: 2, deleted: true }), [{ spec: "削除済みPDFの規格" }]);
    await addRun(await addDocument({ group: OTHER_GROUP, fileName: "納品書2.pdf" }), [
      { spec: "別グループの規格" },
    ]);

    const report = await run();

    expect(report.documentCount).toBe(1);
    expect((await products()).map((p) => p.product_key)).toEqual([KEY]);
  });

  it("leaves unmatched and already linked lines, and their price history, alone", async () => {
    const [existing] = await t.rows<{ product_id: string }>(
      `INSERT INTO product_master (product_key, product_name) VALUES ('既存', '既存商品')
       RETURNING product_id`,
    );
    await t.rows(
      `INSERT INTO update_history
         (update_key, product_id, field_name, vendor_name, after_value, source_type, source_id)
       VALUES ('old-run:x:unit_price', $1, 'unit_price', $2, '100.00', 'PDF', 'old-run')`,
      [existing.product_id, VENDOR],
    );
    await addRun(await addDocument(), [
      { name: "低信頼度の品名", classification: "UNMATCHED", confidence: 0.6 },
      { name: "既存商品", classification: "UPDATE", matchedProductId: existing.product_id },
    ]);

    const report = await run();

    expect(report).toMatchObject({ targetLineCount: 0, alreadyLinkedLineCount: 1 });
    expect(report.unmatchedLines).toMatchObject([{ productName: "低信頼度の品名" }]);
    expect(await count("product_master")).toBe(1);
    expect(await count("product_document_sources")).toBe(0);
    expect(await t.rows(`SELECT update_key FROM update_history`)).toEqual([
      { update_key: "old-run:x:unit_price" },
    ]);
  });

  it("skips lines that match an existing, verified or merged product instead of changing it", async () => {
    await t.rows(
      `INSERT INTO product_master (product_key, product_name, product_maker, spec)
       VALUES ($1, $2, $3, $4)`,
      [KEY, NAME, MAKER, SPEC],
    );
    await addRun(await addDocument(), [{}]);

    const report = await run();

    expect(report.skipped).toMatchObject([{ reason: "EXISTING_PRODUCT_MATCH" }]);
    expect(report.createdProducts).toHaveLength(0);
    expect(await count("vendor_prices")).toBe(0);
    expect(await count("product_document_sources")).toBe(0);
    expect(formatMigrationReport(report)).toContain("既存・確認済みの商品に一致");
  });

  it("does not guess a maker when the stored key cannot be reproduced", async () => {
    await addRun(await addDocument(), [{ maker: null, key: KEY }]);

    const report = await run();

    expect(report.skipped).toMatchObject([{ reason: "KEY_INCONSISTENT" }]);
    expect(await count("product_master")).toBe(0);
  });

  it("does not commit when the created count differs from the expected one", async () => {
    await addRun(await addDocument(), [{}]);

    const report = await run({ expectCreated: 5 });

    expect(report.committed).toBe(false);
    expect(report.abortReason).toContain("一致しません");
    expect(await count("product_master")).toBe(0);

    const ok = await run({ expectCreated: 1 });
    expect(ok.committed).toBe(true);
    expect(await count("product_master")).toBe(1);
  });
});
