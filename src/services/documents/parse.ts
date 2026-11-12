import "server-only";
import { and, asc, desc, eq, inArray, sql } from "drizzle-orm";
import type { PgDatabase, PgQueryResultHKT } from "drizzle-orm/pg-core";
import { getDb } from "@/db/client";
import type * as schema from "@/db/schema";
import {
  documentDiffItems,
  documentLineItems,
  documentParseRuns,
  documents,
  productDocumentSources,
  productMaster,
  productReviewHistory,
  updateHistory,
  vendorPrices,
} from "@/db/schema";
import { getEnv } from "@/config/env";
import { normalizeText, makeProductKey } from "@/domain/normalize";
import { safeParseFloat, toNumericString } from "@/domain/pg-numeric";
import {
  canCreateProvisionalProduct,
  collectAttentionReasons,
  decideUnverifiedPriceAction,
  formatAttentionReason,
  isAutoUpdatableStatus,
  makersConflict,
  SYSTEM_REVIEWER,
} from "@/domain/provisional-product";
import { toReviewStatus, type ReviewStatus } from "@/domain/review-status";
import { shouldBlockUpdate } from "@/domain/update-policy";
import { findSimilarProducts, toMatchCandidateSnapshot } from "@/services/products/candidates";
import { getStorageProvider } from "@/services/storage";
import { parseInvoiceFromPdf } from "@/services/ai/gemini";
import type { ParsedInvoice } from "@/services/ai/schema";
import { assertSinglePagePdf } from "@/services/documents/parse-guard";
import { PROMPT_VERSION } from "@/services/ai/prompt";

type ParseRunInsert = typeof documentParseRuns.$inferInsert;
type LineItemInsert = typeof documentLineItems.$inferInsert;
type DiffItemInsert = typeof documentDiffItems.$inferInsert;
type VendorPriceInsert = typeof vendorPrices.$inferInsert;
type UpdateHistoryInsert = typeof updateHistory.$inferInsert;

const dateRegex = /^\d{4}-\d{2}-\d{2}$/;
const noLineItemsErrorCode = "NO_LINE_ITEMS_EXTRACTED";
const noUsableLineItemsErrorCode = "NO_USABLE_LINE_ITEMS_EXTRACTED";
const noLineItemsSummary =
  "PDFから明細を抽出できませんでした。明細表が写っているか、スキャン品質やPDF内容を確認してください。";
const noUsableLineItemsSummary =
  "PDFから明細候補は抽出されましたが、商品名・商品キーを作成できる明細がありませんでした。明細の品名欄やPDF品質を確認してください。";

type LineItemContext = {
  lineItemId: string;
  lineNo: number;
  productMaker: string | null;
  productNameRaw: string;
  specRaw: string | null;
  productKeyCandidate: string;
  legacyProductKeyCandidate: string;
  quantity: string | null;
  unitPrice: string | null;
  amount: string | null;
  modelConfidence: string | null;
  systemConfidence: string | null;
  systemConfidenceNum: number | null;
  matchedProductId: string | null;
  matchedProductSpec: string | null;
  matchedProductCategory: string | null;
  matchedReviewStatus: ReviewStatus | null;
  resolution: LineResolution;
  /** 同じ書類・同じ行の過去の解析で作られた出典。再解析時に付け替える。 */
  priorSourceLineItemId: string | null;
  /** 商品キーが統合済み商品に一致した場合の統合元と統合先。 */
  mergedProductId: string | null;
  mergeTargetProductId: string | null;
  quantityNum: number | null;
  unitPriceNum: number | null;
  amountNum: number | null;
};

/**
 * 明細と商品の対応付けの結果。
 * - SOURCE: 同じ書類・同じ行の出典紐付け（人による修正・統合を含む）を引き継いだ
 * - EXACT: 統合済みを除く商品キーの完全一致
 * - CREATED: この解析で仮登録した
 * - MERGED_KEY: 商品キーが統合済み商品に一致した（再使用も新規作成もしない）
 * - NONE: 対応する商品なし
 */
type LineResolution = "SOURCE" | "EXACT" | "CREATED" | "MERGED_KEY" | "NONE";

type ProductInfo = {
  productId: string;
  productKey: string;
  productMaker: string | null;
  productName: string;
  spec: string | null;
  category: string | null;
  reviewStatus: ReviewStatus;
  mergedIntoProductId: string | null;
};

const MAX_MERGE_HOPS = 5;

type ParseDb<H extends PgQueryResultHKT> = PgDatabase<H, typeof schema>;

export type PersistParseResultInput = {
  documentId: string;
  parseRunId: string;
  invoiceData: ParsedInvoice;
  /**
   * true のとき、既存商品に一致しない明細を仮登録し、出典と確認履歴を保存する。
   * false のときは従来どおり新規商品候補（NEW_CANDIDATE）として差分に残すだけ。
   * 統合済みの除外や未確認商品の保護は、この値にかかわらず常に働く。
   */
  provisionalCreateEnabled: boolean;
};

type VendorPriceRow = {
  vendorPriceId: string;
  productId: string;
  unitPrice: string;
  priceUpdatedOn: string | null;
};

type DocumentRow = {
  documentId: string;
  storageKey: string;
  isDeleted: boolean;
};

export type ParseDocumentResult = {
  parseRunId: string;
  status: "SUCCEEDED" | "FAILED";
};

function buildParseRunRow(input: {
  parseRunId: string;
  documentId: string;
  model: string;
  stats: Record<string, unknown>;
}): ParseRunInsert {
  return {
    parseRunId: input.parseRunId,
    documentId: input.documentId,
    startedAt: new Date(),
    status: "RUNNING",
    model: input.model,
    promptVersion: PROMPT_VERSION,
    stats: input.stats,
  };
}

function buildLineItemRow(input: LineItemContext & { parseRunId: string }): LineItemInsert {
  return {
    lineItemId: input.lineItemId,
    parseRunId: input.parseRunId,
    lineNo: input.lineNo,
    productMaker: input.productMaker,
    productNameRaw: input.productNameRaw,
    specRaw: input.specRaw,
    productKeyCandidate: input.productKeyCandidate,
    quantity: input.quantity,
    unitPrice: input.unitPrice,
    amount: input.amount,
    modelConfidence: input.modelConfidence,
    systemConfidence: input.systemConfidence,
    matchedProductId: input.matchedProductId,
  };
}

function buildDiffItemRow(input: {
  diffItemId: string;
  parseRunId: string;
  lineItemId: string;
  classification: string;
  reason?: string | null;
  vendorName: string | null;
  invoiceDate: string | null;
  before: Record<string, unknown>;
  after: Record<string, unknown>;
}): DiffItemInsert {
  return {
    diffItemId: input.diffItemId,
    parseRunId: input.parseRunId,
    lineItemId: input.lineItemId,
    classification: input.classification,
    reason: input.reason ?? null,
    vendorName: input.vendorName,
    invoiceDate: input.invoiceDate,
    before: input.before,
    after: input.after,
  };
}

function buildVendorPriceRow(input: {
  vendorPriceId: string;
  productId: string;
  vendorName: string;
  unitPrice: string;
  priceUpdatedOn: string | null;
  sourceId: string;
}): VendorPriceInsert {
  return {
    vendorPriceId: input.vendorPriceId,
    productId: input.productId,
    vendorName: input.vendorName,
    unitPrice: input.unitPrice,
    priceUpdatedOn: input.priceUpdatedOn,
    sourceType: "PDF",
    sourceId: input.sourceId,
    updatedAt: new Date(),
  };
}

function sanitizeProductName(input: { productName: string; productMaker: string | null }): string {
  const normalizedName = normalizeText(input.productName);
  if (!normalizedName) return "";
  if (!input.productMaker) return normalizedName;

  const normalizedMaker = normalizeText(input.productMaker);
  if (!normalizedMaker) return normalizedName;

  const escapedMaker = normalizedMaker.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const makerPrefixRegex = new RegExp(`^${escapedMaker}[\\s:/：｜・-]*`);
  const stripped = normalizedName.replace(makerPrefixRegex, "").trim();
  return stripped || normalizedName;
}

function buildUpdateHistoryRow(input: {
  updateKey: string;
  productId: string;
  fieldName: string;
  vendorName?: string | null;
  beforeValue?: string | null;
  afterValue?: string | null;
  sourceId: string;
}): UpdateHistoryInsert {
  return {
    historyId: crypto.randomUUID(),
    updateKey: input.updateKey,
    productId: input.productId,
    fieldName: input.fieldName,
    vendorName: input.vendorName ?? null,
    beforeValue: input.beforeValue ?? null,
    afterValue: input.afterValue ?? null,
    sourceType: "PDF",
    sourceId: input.sourceId,
    updatedAt: new Date(),
    updatedBy: "SYSTEM",
  };
}

function isNewerInvoiceDate(invoiceDate: string | null, priceUpdatedOn: string | null): boolean {
  if (!invoiceDate) return false;
  if (!priceUpdatedOn) return true;
  return invoiceDate > priceUpdatedOn;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

function computeSystemConfidence(input: {
  modelConfidence: number | null;
  quantity: number | null;
  unitPrice: number | null;
  amount: number | null;
  productName: string;
  spec: string | null;
}): number {
  let score = input.modelConfidence ?? 0.6;
  if (input.productName) {
    score += 0.05;
  }
  if (input.spec) {
    score += 0.05;
  }
  if (input.quantity !== null && input.unitPrice !== null && input.amount !== null) {
    const expected = input.quantity * input.unitPrice;
    const tolerance = Math.max(1, Math.abs(input.amount) * 0.02);
    if (Math.abs(expected - input.amount) <= tolerance) {
      score += 0.1;
    } else {
      score -= 0.1;
    }
  }
  return clamp(score, 0, 1);
}

async function getDocumentRow(documentId: string): Promise<DocumentRow | null> {
  const db = getDb();
  const [row] = await db
    .select({
      documentId: documents.documentId,
      storageKey: documents.storageKey,
      isDeleted: documents.isDeleted,
    })
    .from(documents)
    .where(eq(documents.documentId, documentId))
    .limit(1);
  return row ?? null;
}

async function failParseRun(input: {
  documentId: string;
  parseRunId: string;
  errorDetail: string;
  summary: string;
  stats: Record<string, unknown>;
}) {
  const db = getDb();
  await db.transaction(async (tx) => {
    await tx
      .update(documentParseRuns)
      .set({
        status: "FAILED",
        finishedAt: new Date(),
        errorDetail: input.errorDetail,
        stats: input.stats,
      })
      .where(eq(documentParseRuns.parseRunId, input.parseRunId));
    await tx
      .update(documents)
      .set({ status: "FAILED", parseErrorSummary: input.summary })
      .where(eq(documents.documentId, input.documentId));
  });
}

export async function parseDocument(documentId: string): Promise<ParseDocumentResult> {
  const documentRow = await getDocumentRow(documentId);
  if (!documentRow || documentRow.isDeleted) {
    throw new Error("Document not found");
  }

  const env = getEnv();
  const envModel = env.GEMINI_MODEL;
  const model = envModel && envModel.trim() ? envModel : "gemini-1.5-flash";
  const parseRunId = crypto.randomUUID();

  const db = getDb();
  await db.transaction(async (tx) => {
    const parseRunRow = buildParseRunRow({
      parseRunId,
      documentId,
      model,
      stats: {},
    });
    await tx.insert(documentParseRuns).values(parseRunRow);

    await tx
      .update(documents)
      .set({ status: "PARSING", parseErrorSummary: null })
      .where(eq(documents.documentId, documentId));
  });

  let invoiceData;
  const pageCount = 1;
  try {
    const storage = getStorageProvider();
    if (!storage.getDownloadUrl) {
      throw new Error("Storage provider does not support download");
    }
    const url = await storage.getDownloadUrl(documentRow.storageKey);
    const headers: Record<string, string> = {};
    if (env.BLOB_READ_WRITE_TOKEN) {
      headers.authorization = `Bearer ${env.BLOB_READ_WRITE_TOKEN}`;
    }
    const pdfResponse = await fetch(url, { headers });
    if (!pdfResponse.ok) {
      throw new Error("Failed to download PDF");
    }
    const buffer = Buffer.from(await pdfResponse.arrayBuffer());
    assertSinglePagePdf(buffer);
    invoiceData = await parseInvoiceFromPdf(buffer.toString("base64"));

    console.info("document_parse_pages", {
      documentId,
      parseRunId,
      pageCount,
    });
  } catch (error) {
    const detail =
      error instanceof Error && error.message.startsWith("MULTI_PAGE_DOCUMENT_NOT_ALLOWED")
        ? error.message
        : "PARSE_ERROR";
    const summary =
      detail === "PARSE_ERROR"
        ? "解析に失敗しました。"
        : "1ページPDFのみ解析可能です。アップロードをやり直してください。";
    await failParseRun({
      documentId,
      parseRunId,
      errorDetail: detail,
      summary,
      stats: {
        pageCount,
        processedPages: 0,
      },
    });
    throw error;
  }

  const rawLineItemCount = invoiceData.lineItems.length;
  console.info("document_parse_result", {
    documentId,
    parseRunId,
    vendorName: invoiceData.vendorName ?? null,
    invoiceDate: invoiceData.invoiceDate ?? null,
    lineItemCount: rawLineItemCount,
  });

  if (rawLineItemCount === 0) {
    await failParseRun({
      documentId,
      parseRunId,
      errorDetail: noLineItemsErrorCode,
      summary: noLineItemsSummary,
      stats: {
        rawLineItemCount: 0,
        lineItemCount: 0,
        diffCount: 0,
        pageCount,
        processedPages: 1,
      },
    });

    throw new Error(noLineItemsErrorCode);
  }

  await persistParseResult(db, {
    documentId,
    parseRunId,
    invoiceData,
    provisionalCreateEnabled: isProvisionalCreateEnabled(env.ENABLE_PROVISIONAL_PRODUCTS),
  });

  return { parseRunId, status: "SUCCEEDED" };
}

export function isProvisionalCreateEnabled(value: string | undefined): boolean {
  const normalized = value?.trim().toLowerCase();
  return normalized === "1" || normalized === "true";
}

/**
 * 解析結果を1トランザクションで保存する。
 * 商品・仕入先単価・出典・確認履歴・差分のどれかが失敗した場合は全体を取り消す。
 */
export async function persistParseResult<H extends PgQueryResultHKT>(
  db: ParseDb<H>,
  input: PersistParseResultInput,
): Promise<void> {
  const { documentId, parseRunId, invoiceData, provisionalCreateEnabled } = input;
  const pageCount = 1;
  const rawLineItemCount = invoiceData.lineItems.length;
  const vendorName = invoiceData.vendorName ? normalizeText(invoiceData.vendorName) : null;
  const invoiceDate =
    invoiceData.invoiceDate && dateRegex.test(invoiceData.invoiceDate)
      ? invoiceData.invoiceDate
      : null;

  await db.transaction(async (tx) => {
    // 同じ書類の解析結果の保存を直列化する（再送・並行実行で出典を二重に付け替えない）。
    await tx
      .select({ documentId: documents.documentId })
      .from(documents)
      .where(eq(documents.documentId, documentId))
      .for("update");

    const productColumns = {
      productId: productMaster.productId,
      productKey: productMaster.productKey,
      productMaker: productMaster.productMaker,
      productName: productMaster.productName,
      spec: productMaster.spec,
      category: productMaster.category,
      reviewStatus: productMaster.reviewStatus,
      mergedIntoProductId: productMaster.mergedIntoProductId,
    };
    type ProductDbRow = {
      productId: string;
      productKey: string;
      productMaker: string | null;
      productName: string;
      spec: string | null;
      category: string | null;
      reviewStatus: string;
      mergedIntoProductId: string | null;
    };
    const toProductInfo = (row: ProductDbRow): ProductInfo => ({
      productId: row.productId,
      productKey: row.productKey,
      productMaker: row.productMaker ?? null,
      productName: row.productName,
      spec: row.spec ?? null,
      category: row.category ?? null,
      reviewStatus: toReviewStatus(row.reviewStatus),
      mergedIntoProductId: row.mergedIntoProductId ?? null,
    });
    const getProductById = async (productId: string): Promise<ProductInfo | null> => {
      const [row] = await tx
        .select(productColumns)
        .from(productMaster)
        .where(eq(productMaster.productId, productId))
        .limit(1);
      return row ? toProductInfo(row) : null;
    };
    /** 統合済みなら統合先をたどり、統合済みでない商品を返す。循環や欠落は null。 */
    const resolveActiveProduct = async (productId: string): Promise<ProductInfo | null> => {
      let currentId: string | null = productId;
      for (let hop = 0; hop <= MAX_MERGE_HOPS && currentId; hop += 1) {
        const product = await getProductById(currentId);
        if (!product) return null;
        if (product.reviewStatus !== "MERGED") return product;
        currentId = product.mergedIntoProductId;
      }
      return null;
    };

    const productKeySet = new Set<string>();
    invoiceData.lineItems.forEach((item) => {
      const productMaker = item.productMaker ? normalizeText(item.productMaker) : null;
      const name = sanitizeProductName({
        productName: item.productName ?? "",
        productMaker,
      });
      if (!name) return;
      const spec = item.spec ?? null;
      const key = makeProductKey(name, spec, productMaker);
      const legacyKey = makeProductKey(name, spec);
      if (key) productKeySet.add(key);
      if (legacyKey) productKeySet.add(legacyKey);
    });
    const productKeys = Array.from(productKeySet);

    const productRows = productKeys.length
      ? await tx
          .select(productColumns)
          .from(productMaster)
          .orderBy(desc(productMaster.lastUpdatedAt), asc(productMaster.productId))
          .where(inArray(productMaster.productKey, productKeys))
      : [];

    // 統合済み商品は自動照合の対象にしない。キーが一致した場合の案内用に別で保持する。
    const productMap = new Map<string, ProductInfo>();
    const mergedMap = new Map<string, ProductInfo>();
    for (const row of productRows) {
      const info = toProductInfo(row);
      const target = info.reviewStatus === "MERGED" ? mergedMap : productMap;
      if (!target.has(info.productKey)) target.set(info.productKey, info);
    }

    // 同じ書類の過去の解析で作られた出典紐付け。人が修正・統合した結果を
    // 再解析で元に戻さないよう、商品キーの照合より優先する。
    const priorSourceRows = await tx
      .select({
        lineItemId: productDocumentSources.lineItemId,
        productId: productDocumentSources.productId,
        lineNo: documentLineItems.lineNo,
        productKeyCandidate: documentLineItems.productKeyCandidate,
      })
      .from(productDocumentSources)
      .innerJoin(
        documentLineItems,
        eq(productDocumentSources.lineItemId, documentLineItems.lineItemId),
      )
      .innerJoin(documentParseRuns, eq(documentLineItems.parseRunId, documentParseRuns.parseRunId))
      .where(eq(documentParseRuns.documentId, documentId))
      .orderBy(desc(productDocumentSources.linkedAt));

    const priorSourceKey = (lineNo: number, productKey: string) => `${lineNo}\u0000${productKey}`;
    const priorSourceMap = new Map<string, { lineItemId: string; product: ProductInfo }>();
    for (const row of priorSourceRows) {
      if (!row.productKeyCandidate) continue;
      const key = priorSourceKey(row.lineNo, row.productKeyCandidate);
      if (priorSourceMap.has(key)) continue;
      const product = await resolveActiveProduct(row.productId);
      if (product) priorSourceMap.set(key, { lineItemId: row.lineItemId, product });
    }

    const resolveMergedKey = async (
      merged: ProductInfo,
    ): Promise<
      Pick<LineItemContext, "resolution" | "mergedProductId" | "mergeTargetProductId">
    > => {
      const target = await resolveActiveProduct(merged.productId);
      return {
        resolution: "MERGED_KEY",
        mergedProductId: merged.productId,
        mergeTargetProductId: target?.productId ?? null,
      };
    };

    const lineContexts: LineItemContext[] = [];

    for (const [index, item] of invoiceData.lineItems.entries()) {
      const productMaker = item.productMaker ? normalizeText(item.productMaker) : null;
      const productNameRaw = sanitizeProductName({
        productName: item.productName ?? "",
        productMaker,
      });
      if (!productNameRaw) continue;
      const specRaw = item.spec ? normalizeText(item.spec) : null;
      const productKeyCandidate = makeProductKey(productNameRaw, specRaw, productMaker);
      const legacyProductKeyCandidate = makeProductKey(productNameRaw, specRaw);
      if (!productKeyCandidate) continue;
      const lineNo = item.lineNo ?? index + 1;
      const quantityNum = safeParseFloat(item.quantity);
      const unitPriceNum = safeParseFloat(item.unitPrice);
      const amountNum = safeParseFloat(item.amount);
      const quantity = toNumericString(item.quantity, 3);
      const unitPrice = toNumericString(item.unitPrice, 2);
      const amount = toNumericString(item.amount, 2);
      const modelConfidenceNum = safeParseFloat(item.confidence);
      const modelConfidence = toNumericString(modelConfidenceNum, 3);
      const systemConfidenceNum = computeSystemConfidence({
        modelConfidence: modelConfidenceNum,
        quantity: quantityNum,
        unitPrice: unitPriceNum,
        amount: amountNum,
        productName: productNameRaw,
        spec: specRaw,
      });
      const systemConfidence = toNumericString(systemConfidenceNum, 3);

      // 1) 同じ書類・同じ行の出典紐付け  2) 統合済みを除く商品キーの完全一致
      // 旧形式キー（メーカーなし）での一致は、メーカーが矛盾する場合は採用しない。
      const priorSource = priorSourceMap.get(priorSourceKey(lineNo, productKeyCandidate)) ?? null;
      const legacyMatch = (map: Map<string, ProductInfo>) => {
        const candidate = map.get(legacyProductKeyCandidate);
        return candidate && !makersConflict(productMaker, candidate.productMaker)
          ? candidate
          : undefined;
      };
      const matched =
        priorSource?.product ?? productMap.get(productKeyCandidate) ?? legacyMatch(productMap);
      const mergedKeyMatch = matched
        ? undefined
        : (mergedMap.get(productKeyCandidate) ?? legacyMatch(mergedMap));
      const unmatched = mergedKeyMatch
        ? await resolveMergedKey(mergedKeyMatch)
        : { resolution: "NONE" as const, mergedProductId: null, mergeTargetProductId: null };

      lineContexts.push({
        lineItemId: crypto.randomUUID(),
        lineNo,
        productMaker,
        productNameRaw,
        specRaw,
        productKeyCandidate,
        legacyProductKeyCandidate,
        quantity,
        unitPrice,
        amount,
        modelConfidence,
        systemConfidence,
        systemConfidenceNum,
        matchedProductId: matched?.productId ?? null,
        matchedProductSpec: matched?.spec ?? null,
        matchedProductCategory: matched?.category ?? null,
        matchedReviewStatus: matched?.reviewStatus ?? null,
        ...(matched
          ? {
              resolution: priorSource ? ("SOURCE" as const) : ("EXACT" as const),
              mergedProductId: null,
              mergeTargetProductId: null,
            }
          : unmatched),
        priorSourceLineItemId: priorSource?.lineItemId ?? null,
        quantityNum,
        unitPriceNum,
        amountNum,
      });
    }

    console.info("document_parse_normalized", {
      documentId,
      parseRunId,
      rawLineItemCount,
      lineItemCount: lineContexts.length,
    });

    if (lineContexts.length === 0) {
      await tx
        .update(documentParseRuns)
        .set({
          status: "FAILED",
          finishedAt: new Date(),
          errorDetail: noUsableLineItemsErrorCode,
          stats: {
            rawLineItemCount,
            lineItemCount: 0,
            diffCount: 0,
            pageCount,
            processedPages: 1,
          },
        })
        .where(eq(documentParseRuns.parseRunId, parseRunId));
      await tx
        .update(documents)
        .set({ status: "FAILED", parseErrorSummary: noUsableLineItemsSummary })
        .where(eq(documents.documentId, documentId));
      return;
    }

    // 仮登録: 既存商品に一致せず、条件を満たす明細から未確認の商品を作成する。
    //
    // 本番DBの product_master には product_key の一意制約がない（旧来の重複キーもある）。
    // そのため制約には頼らず、作成の直前に商品テーブルを SHARE ROW EXCLUSIVE でロックし、
    // ロック取得後にキーを確認し直してから作成する。このロックモードは自身と競合するので、
    // 並行する解析や手動移行の商品作成は直列化され、同じキーの商品が二重に作られない。
    // 読み取りは妨げない。ロックはこのトランザクションの終了まで保持される。
    const createdProductIds = new Set<string>();
    let productTableLocked = false;
    if (provisionalCreateEnabled) {
      for (const context of lineContexts) {
        if (context.resolution !== "NONE") continue;
        if (!canCreateProvisionalProduct(context.systemConfidenceNum)) continue;

        const applyMatch = (product: ProductInfo, resolution: LineResolution) => {
          context.matchedProductId = product.productId;
          context.matchedProductSpec = product.spec;
          context.matchedProductCategory = product.category;
          context.matchedReviewStatus = product.reviewStatus;
          context.resolution = resolution;
        };

        // 同じ解析内の別明細で作成・照合済みの商品は、同じ商品へ出典を追加する。
        const known = productMap.get(context.productKeyCandidate);
        if (known) {
          applyMatch(known, "EXACT");
          continue;
        }

        if (!productTableLocked) {
          await tx.execute(sql`LOCK TABLE product_master IN SHARE ROW EXCLUSIVE MODE`);
          productTableLocked = true;
        }

        // ロック取得までの間に、別の処理が同じキーの商品を登録している可能性がある。
        // 重複キーが既にある場合は、統合済みでない最新の行を優先する。
        const [existing] = await tx
          .select(productColumns)
          .from(productMaster)
          .where(eq(productMaster.productKey, context.productKeyCandidate))
          .orderBy(
            sql`(${productMaster.reviewStatus} = 'MERGED')`,
            desc(productMaster.lastUpdatedAt),
            asc(productMaster.productId),
          )
          .limit(1);
        if (existing) {
          const info = toProductInfo(existing);
          if (info.reviewStatus === "MERGED") {
            Object.assign(context, await resolveMergedKey(info));
          } else {
            productMap.set(info.productKey, info);
            applyMatch(info, "EXACT");
          }
          continue;
        }

        const now = new Date();
        const [created] = await tx
          .insert(productMaster)
          .values({
            productId: crypto.randomUUID(),
            productKey: context.productKeyCandidate,
            productMaker: context.productMaker,
            productName: context.productNameRaw,
            spec: context.specRaw,
            // カテゴリは推測しない（「未分類」も付けない）。確認時に人が設定する。
            category: null,
            qualityFlag: "OK",
            lastUpdatedAt: now,
            lastSourceType: "PDF",
            lastSourceId: parseRunId,
            // DB既定値（LEGACY）に任せず、未確認であることを明示する。
            reviewStatus: "PROVISIONAL",
          })
          .returning(productColumns);

        const info = toProductInfo(created);
        productMap.set(info.productKey, info);
        createdProductIds.add(info.productId);
        applyMatch(info, "CREATED");
      }
    }

    const lineItemRows = lineContexts.map((context) =>
      buildLineItemRow({ ...context, parseRunId }),
    );
    if (lineItemRows.length) {
      await tx.insert(documentLineItems).values(lineItemRows);
    }
    console.info("document_parse_line_items_inserted", {
      documentId,
      parseRunId,
      count: lineItemRows.length,
    });

    const matchedProductIds = lineContexts
      .map((context) => context.matchedProductId)
      .filter((id): id is string => Boolean(id));

    const vendorRows: VendorPriceRow[] =
      matchedProductIds.length && vendorName
        ? await tx
            .select({
              vendorPriceId: vendorPrices.vendorPriceId,
              productId: vendorPrices.productId,
              unitPrice: vendorPrices.unitPrice,
              priceUpdatedOn: vendorPrices.priceUpdatedOn,
            })
            .from(vendorPrices)
            .where(
              and(
                inArray(vendorPrices.productId, matchedProductIds),
                eq(vendorPrices.vendorName, vendorName),
              ),
            )
        : [];

    const vendorMap = new Map(vendorRows.map((row) => [row.productId, row]));

    const diffRows: DiffItemInsert[] = [];

    for (const context of lineContexts) {
      const before: Record<string, unknown> = {};
      const after: Record<string, unknown> = {
        productName: context.productNameRaw,
        productMaker: context.productMaker,
        spec: context.specRaw,
        productKeyCandidate: context.productKeyCandidate,
        unitPrice: context.unitPrice,
        amount: context.amount,
      };

      if (!context.matchedProductId && context.resolution === "MERGED_KEY") {
        // 統合済み商品のキーに一致。統合済み行は再使用せず、同じキーの新規作成もしない。
        // 統合先を確認候補として差分に残し、人の確認に回す。
        diffRows.push(
          buildDiffItemRow({
            diffItemId: crypto.randomUUID(),
            parseRunId,
            lineItemId: context.lineItemId,
            classification: "UNMATCHED",
            reason: "MATCHES_MERGED_PRODUCT",
            vendorName,
            invoiceDate,
            before,
            after: {
              ...after,
              mergedProductId: context.mergedProductId,
              mergeTargetProductId: context.mergeTargetProductId,
            },
          }),
        );
        continue;
      }

      if (!context.matchedProductId) {
        const canCreateCandidate = canCreateProvisionalProduct(context.systemConfidenceNum);
        diffRows.push(
          buildDiffItemRow({
            diffItemId: crypto.randomUUID(),
            parseRunId,
            lineItemId: context.lineItemId,
            classification: canCreateCandidate ? "NEW_CANDIDATE" : "UNMATCHED",
            reason: canCreateCandidate
              ? "REVIEW_REQUIRED_BEFORE_PRODUCT_CREATE"
              : "NO_PRODUCT_MATCH",
            vendorName,
            invoiceDate,
            before,
            after,
          }),
        );
        continue;
      }

      const matchedProductId = context.matchedProductId;
      const matchedStatus = context.matchedReviewStatus ?? "LEGACY";
      const isUnverified = !isAutoUpdatableStatus(matchedStatus);
      const wasCreated = context.resolution === "CREATED";

      const priceAction = isUnverified
        ? decideUnverifiedPriceAction({
            existingUnitPrice: safeParseFloat(vendorMap.get(matchedProductId)?.unitPrice ?? null),
            newUnitPrice: safeParseFloat(context.unitPrice),
            vendorName,
          })
        : "NONE";

      if (provisionalCreateEnabled) {
        // 出典の保存。未確認商品には注意理由も残す（確認済み・既存商品には付けない）。
        const attentionReasons = isUnverified
          ? collectAttentionReasons({
              unitPrice: context.unitPriceNum,
              quantity: context.quantityNum,
              amount: context.amountNum,
              vendorName,
              invoiceDate,
              spec: context.specRaw,
            })
          : [];
        if (priceAction === "CONFLICT") attentionReasons.push("登録済みの単価と相違");
        const attentionReason = formatAttentionReason(attentionReasons);

        // 同じ書類・同じ行の再解析では、出典を増やさず新しい明細へ付け替える。
        const repointed = context.priorSourceLineItemId
          ? await tx
              .update(productDocumentSources)
              .set({
                lineItemId: context.lineItemId,
                // 注意理由はシステムが付けたものだけを更新する。
                ...(isUnverified ? { attentionReason } : {}),
              })
              .where(eq(productDocumentSources.lineItemId, context.priorSourceLineItemId))
              .returning({ lineItemId: productDocumentSources.lineItemId })
          : [];
        if (repointed.length === 0) {
          // 仮登録時は、照合時点の類似候補を残す（確定した紐付けではなく、確認時の参考）。
          const matchCandidates = wasCreated
            ? toMatchCandidateSnapshot(
                await findSimilarProducts(tx, {
                  productId: matchedProductId,
                  productName: context.productNameRaw,
                  productMaker: context.productMaker,
                  spec: context.specRaw,
                }),
              )
            : [];
          await tx
            .insert(productDocumentSources)
            .values({
              lineItemId: context.lineItemId,
              productId: matchedProductId,
              linkedBy: SYSTEM_REVIEWER,
              linkMethod: wasCreated ? "PROVISIONAL_CREATE" : "EXACT_MATCH",
              attentionReason,
              matchCandidates,
            })
            .onConflictDoNothing({ target: productDocumentSources.lineItemId });
        }

        if (wasCreated) {
          await tx.insert(productReviewHistory).values({
            productId: matchedProductId,
            action: "PROVISIONAL_CREATE",
            sourceLineItemId: context.lineItemId,
            beforeSnapshot: {},
            afterSnapshot: {
              productKey: context.productKeyCandidate,
              productName: context.productNameRaw,
              productMaker: context.productMaker,
              spec: context.specRaw,
              category: null,
              reviewStatus: "PROVISIONAL",
              vendorName,
              unitPrice: context.unitPrice,
              invoiceDate,
              systemConfidence: context.systemConfidence,
              documentId,
              parseRunId,
            },
            note: attentionReason,
            reviewedBy: SYSTEM_REVIEWER,
          });
        }
      }

      if (isUnverified) {
        // 未確認（仮登録・要確認）商品は自動更新しない。
        // - 規格・品名は書き換えない（手動修正を再解析で戻さない）
        // - 登録済みの単価は上書きしない。相違は差分に残して人が選ぶ
        // - 単価が未設定の仕入先には追加するが、商品は未確認のまま
        const existingVendor = vendorMap.get(matchedProductId) ?? null;
        if (existingVendor) {
          before.unitPrice = existingVendor.unitPrice;
          before.priceUpdatedOn = existingVendor.priceUpdatedOn;
        }
        before.productId = matchedProductId;
        before.spec = context.matchedProductSpec;
        before.category = context.matchedProductCategory;
        before.reviewStatus = matchedStatus;

        let priceAdded = false;
        if (priceAction === "ADD" && vendorName && context.unitPrice) {
          const [insertedPrice] = await tx
            .insert(vendorPrices)
            .values(
              buildVendorPriceRow({
                vendorPriceId: crypto.randomUUID(),
                productId: matchedProductId,
                vendorName,
                unitPrice: context.unitPrice,
                priceUpdatedOn: invoiceDate,
                sourceId: parseRunId,
              }),
            )
            .onConflictDoNothing({ target: [vendorPrices.productId, vendorPrices.vendorName] })
            .returning({
              vendorPriceId: vendorPrices.vendorPriceId,
              productId: vendorPrices.productId,
              unitPrice: vendorPrices.unitPrice,
              priceUpdatedOn: vendorPrices.priceUpdatedOn,
            });
          if (insertedPrice) {
            priceAdded = true;
            // 同じ解析内の後続明細が、いま追加した単価を比較元にできるようにする。
            vendorMap.set(matchedProductId, insertedPrice);
            await tx
              .insert(updateHistory)
              .values(
                buildUpdateHistoryRow({
                  updateKey: `${parseRunId}:${matchedProductId}:unit_price`,
                  productId: matchedProductId,
                  fieldName: "unit_price",
                  vendorName,
                  beforeValue: null,
                  afterValue: context.unitPrice,
                  sourceId: parseRunId,
                }),
              )
              .onConflictDoNothing({ target: updateHistory.updateKey });
          }
        }

        let classification = "NO_CHANGE";
        let reason = "LINKED_TO_UNVERIFIED_PRODUCT";
        if (wasCreated) {
          classification = "UPDATE";
          reason = "PROVISIONAL_PRODUCT_CREATED";
        } else if (priceAction === "CONFLICT") {
          classification = "BLOCKED";
          reason = "UNVERIFIED_PRODUCT_PRICE_CONFLICT";
        } else if (priceAdded) {
          classification = "UPDATE";
          reason = "UNVERIFIED_PRODUCT_PRICE_ADDED";
        }

        diffRows.push(
          buildDiffItemRow({
            diffItemId: crypto.randomUUID(),
            parseRunId,
            lineItemId: context.lineItemId,
            classification,
            reason,
            vendorName,
            invoiceDate,
            before: wasCreated ? {} : before,
            after: { ...after, productId: matchedProductId },
          }),
        );
        continue;
      }

      const existingVendor = vendorMap.get(context.matchedProductId) ?? null;
      const existingUnitPrice = existingVendor?.unitPrice ?? null;
      const existingUnitPriceNum = safeParseFloat(existingUnitPrice);
      const newUnitPriceNum = safeParseFloat(context.unitPrice);
      const hasPriceChange =
        newUnitPriceNum !== null &&
        (existingUnitPriceNum === null || newUnitPriceNum !== existingUnitPriceNum);

      const hasSpecChange =
        context.specRaw !== null &&
        context.specRaw.trim() !== "" &&
        context.specRaw !== (context.matchedProductSpec ?? null);

      const priceDeviation =
        existingUnitPriceNum !== null && newUnitPriceNum !== null && existingUnitPriceNum > 0
          ? Math.abs(newUnitPriceNum - existingUnitPriceNum) / existingUnitPriceNum
          : existingUnitPriceNum === null && newUnitPriceNum !== null
            ? 0
            : hasPriceChange
              ? null
              : 0;

      const requiresUpdate = hasPriceChange || hasSpecChange;
      const policy = requiresUpdate
        ? shouldBlockUpdate({
            systemConfidenceNum: context.systemConfidenceNum,
            vendorName,
            unitPriceNum: hasPriceChange
              ? newUnitPriceNum
              : (existingUnitPriceNum ?? newUnitPriceNum),
            keyIsWeak: !context.specRaw,
            deviation: hasPriceChange ? priceDeviation : 0,
          })
        : { blocked: false };

      if (existingVendor) {
        before.unitPrice = existingVendor.unitPrice;
        before.priceUpdatedOn = existingVendor.priceUpdatedOn;
      }
      before.productId = context.matchedProductId;
      before.spec = context.matchedProductSpec;
      before.category = context.matchedProductCategory;

      let classification = "NO_CHANGE";
      if (requiresUpdate) {
        classification = policy.blocked ? "BLOCKED" : "UPDATE";
      }

      diffRows.push(
        buildDiffItemRow({
          diffItemId: crypto.randomUUID(),
          parseRunId,
          lineItemId: context.lineItemId,
          classification,
          reason: policy.reason,
          vendorName,
          invoiceDate,
          before,
          after,
        }),
      );

      if (policy.blocked) continue;

      if (hasSpecChange) {
        const historyRow = buildUpdateHistoryRow({
          updateKey: `${parseRunId}:${context.matchedProductId}:spec`,
          productId: context.matchedProductId,
          fieldName: "spec",
          vendorName,
          beforeValue: context.matchedProductSpec ?? null,
          afterValue: context.specRaw,
          sourceId: parseRunId,
        });

        await tx.insert(updateHistory).values(historyRow);
        await tx
          .update(productMaster)
          .set({
            spec: context.specRaw,
            lastUpdatedAt: new Date(),
            lastSourceType: "PDF",
            lastSourceId: parseRunId,
          })
          .where(eq(productMaster.productId, context.matchedProductId));
      }

      if (hasPriceChange && context.unitPrice) {
        if (!vendorName) continue;
        const canUpdateByDate = isNewerInvoiceDate(
          invoiceDate,
          existingVendor?.priceUpdatedOn ?? null,
        );
        let updated = false;
        if (existingVendor) {
          if (canUpdateByDate) {
            await tx
              .update(vendorPrices)
              .set({
                unitPrice: context.unitPrice,
                priceUpdatedOn: invoiceDate,
                sourceType: "PDF",
                sourceId: parseRunId,
                updatedAt: new Date(),
              })
              .where(eq(vendorPrices.vendorPriceId, existingVendor.vendorPriceId));
            updated = true;
          }
        } else {
          const vendorRow = buildVendorPriceRow({
            vendorPriceId: crypto.randomUUID(),
            productId: context.matchedProductId,
            vendorName,
            unitPrice: context.unitPrice,
            priceUpdatedOn: invoiceDate,
            sourceId: parseRunId,
          });
          await tx.insert(vendorPrices).values(vendorRow);
          updated = true;
        }

        if (updated) {
          const historyRow = buildUpdateHistoryRow({
            updateKey: `${parseRunId}:${context.matchedProductId}:unit_price`,
            productId: context.matchedProductId,
            fieldName: "unit_price",
            vendorName,
            beforeValue: existingVendor?.unitPrice ?? null,
            afterValue: context.unitPrice,
            sourceId: parseRunId,
          });
          await tx.insert(updateHistory).values(historyRow);
        }
      }
    }

    if (diffRows.length) {
      await tx.insert(documentDiffItems).values(diffRows);
    }
    console.info("document_parse_diff_items_inserted", {
      documentId,
      parseRunId,
      count: diffRows.length,
    });

    await tx
      .update(documents)
      .set({
        status: "PARSED",
        vendorName,
        invoiceDate,
        parseErrorSummary: null,
      })
      .where(eq(documents.documentId, documentId));

    await tx
      .update(documentParseRuns)
      .set({
        status: "SUCCEEDED",
        finishedAt: new Date(),
        stats: {
          rawLineItemCount,
          lineItemCount: lineContexts.length,
          diffCount: diffRows.length,
          pageCount,
          processedPages: 1,
          newCandidateCount: diffRows.filter((row) => row.classification === "NEW_CANDIDATE")
            .length,
          unmatchedCount: diffRows.filter((row) => row.classification === "UNMATCHED").length,
          provisionalCreatedCount: createdProductIds.size,
        },
      })
      .where(eq(documentParseRuns.parseRunId, parseRunId));

    console.info("document_parse_completed", {
      documentId,
      parseRunId,
      status: "SUCCEEDED",
      lineItemCount: lineContexts.length,
      diffCount: diffRows.length,
      provisionalCreatedCount: createdProductIds.size,
    });
  });
}
