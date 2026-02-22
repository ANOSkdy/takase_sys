import "server-only";
import { and, eq, inArray, sql } from "drizzle-orm";
import { getDb } from "@/db/client";
import {
  documentDiffItems,
  documentLineItems,
  documentParseRuns,
  documents,
  productMaster,
  updateHistory,
  vendorPrices,
} from "@/db/schema";
import { getEnv } from "@/config/env";
import { normalizeText, makeProductKey } from "@/domain/normalize";
import { safeParseFloat, toNumericString } from "@/domain/pg-numeric";
import { shouldBlockUpdate } from "@/domain/update-policy";
import { getStorageProvider } from "@/services/storage";
import { parseInvoiceFromPdf } from "@/services/ai/gemini";
import { assertSinglePagePdf } from "@/services/documents/parse-guard";
import { PDF_DEFAULT_CATEGORY, resolveCategory } from "@/services/documents/category";
import { PROMPT_VERSION } from "@/services/ai/prompt";

type ParseRunInsert = typeof documentParseRuns.$inferInsert;
type LineItemInsert = typeof documentLineItems.$inferInsert;
type DiffItemInsert = typeof documentDiffItems.$inferInsert;
type VendorPriceInsert = typeof vendorPrices.$inferInsert;
type ProductInsert = typeof productMaster.$inferInsert;
type UpdateHistoryInsert = typeof updateHistory.$inferInsert;

const dateRegex = /^\d{4}-\d{2}-\d{2}$/;

type LineItemContext = {
  lineItemId: string;
  lineNo: number;
  productNameRaw: string;
  specRaw: string | null;
  productKeyCandidate: string;
  quantity: string | null;
  unitPrice: string | null;
  amount: string | null;
  modelConfidence: string | null;
  systemConfidence: string | null;
  systemConfidenceNum: number | null;
  matchedProductId: string | null;
  matchedProductSpec: string | null;
  matchedProductCategory: string | null;
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

function buildProductRow(input: {
  productId: string;
  productKey: string;
  productName: string;
  spec: string | null;
  defaultUnitPrice: string | null;
  qualityFlag: string;
  sourceId: string;
}): ProductInsert {
  return {
    productId: input.productId,
    productKey: input.productKey,
    productName: input.productName,
    spec: input.spec,
    category: resolveCategory({ existing: null, incoming: null }),
    defaultUnitPrice: input.defaultUnitPrice,
    qualityFlag: input.qualityFlag,
    lastUpdatedAt: new Date(),
    lastSourceType: "PDF",
    lastSourceId: input.sourceId,
  };
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
    await db.transaction(async (tx) => {
      await tx
        .update(documentParseRuns)
        .set({ status: "FAILED", finishedAt: new Date(), errorDetail: detail })
        .where(eq(documentParseRuns.parseRunId, parseRunId));
      await tx
        .update(documents)
        .set({ status: "FAILED", parseErrorSummary: summary })
        .where(eq(documents.documentId, documentId));
    });
    throw error;
  }

  const vendorName = invoiceData.vendorName ? normalizeText(invoiceData.vendorName) : null;
  const invoiceDate =
    invoiceData.invoiceDate && dateRegex.test(invoiceData.invoiceDate)
      ? invoiceData.invoiceDate
      : null;

  await db.transaction(async (tx) => {
    const productKeySet = new Set<string>();
    invoiceData.lineItems.forEach((item) => {
      const name = item.productName?.trim() ?? "";
      if (!name) return;
      const spec = item.spec ?? null;
      const key = makeProductKey(name, spec);
      if (key) productKeySet.add(key);
    });
    const productKeys = Array.from(productKeySet);

    const productRows = productKeys.length
      ? await tx
          .select({
            productId: productMaster.productId,
            productKey: productMaster.productKey,
            productName: productMaster.productName,
            spec: productMaster.spec,
            defaultUnitPrice: productMaster.defaultUnitPrice,
            qualityFlag: productMaster.qualityFlag,
            category: productMaster.category,
          })
          .from(productMaster)
          .where(inArray(productMaster.productKey, productKeys))
      : [];

    const productMap = new Map(
      productRows.map((row) => [
        row.productKey,
        {
          productId: row.productId,
          productKey: row.productKey,
          productName: row.productName,
          spec: row.spec ?? null,
          defaultUnitPrice: row.defaultUnitPrice ?? null,
          qualityFlag: row.qualityFlag,
          category: row.category ?? null,
        },
      ]),
    );

    const lineContexts: LineItemContext[] = [];

    invoiceData.lineItems.forEach((item, index) => {
      const productNameRaw = normalizeText(item.productName ?? "");
      if (!productNameRaw) return;
      const specRaw = item.spec ? normalizeText(item.spec) : null;
      const productKeyCandidate = makeProductKey(productNameRaw, specRaw);
      if (!productKeyCandidate) return;
      const quantity = toNumericString(item.quantity, 3);
      const unitPrice = toNumericString(item.unitPrice, 2);
      const amount = toNumericString(item.amount, 2);
      const modelConfidenceNum = safeParseFloat(item.confidence);
      const modelConfidence = toNumericString(modelConfidenceNum, 3);
      const systemConfidenceNum = computeSystemConfidence({
        modelConfidence: modelConfidenceNum,
        quantity: safeParseFloat(item.quantity),
        unitPrice: safeParseFloat(item.unitPrice),
        amount: safeParseFloat(item.amount),
        productName: productNameRaw,
        spec: specRaw,
      });
      const systemConfidence = toNumericString(systemConfidenceNum, 3);
      const matched = productMap.get(productKeyCandidate);
      lineContexts.push({
        lineItemId: crypto.randomUUID(),
        lineNo: item.lineNo ?? index + 1,
        productNameRaw,
        specRaw,
        productKeyCandidate,
        quantity,
        unitPrice,
        amount,
        modelConfidence,
        systemConfidence,
        systemConfidenceNum,
        matchedProductId: matched?.productId ?? null,
        matchedProductSpec: matched?.spec ?? null,
        matchedProductCategory: matched?.category ?? null,
      });
    });

    for (const context of lineContexts) {
      if (context.matchedProductId) continue;
      const confidence = context.systemConfidenceNum;
      if (confidence === null || confidence < 0.9) continue;
      if (!context.productNameRaw) continue;
      const productId = crypto.randomUUID();
      const qualityFlag = context.specRaw ? "OK" : "WARN_KEY_WEAK";
      const productRow = buildProductRow({
        productId,
        productKey: context.productKeyCandidate,
        productName: context.productNameRaw,
        spec: context.specRaw,
        defaultUnitPrice: context.unitPrice,
        qualityFlag,
        sourceId: parseRunId,
      });

      const [upserted] = await tx
        .insert(productMaster)
        .values(productRow)
        .onConflictDoUpdate({
          target: productMaster.productKey,
          set: {
            category: sql`COALESCE(NULLIF(NULLIF(excluded.category, ''), ${PDF_DEFAULT_CATEGORY}), ${productMaster.category})`,
            lastUpdatedAt: new Date(),
            lastSourceType: "PDF",
            lastSourceId: parseRunId,
          },
        })
        .returning({
          productId: productMaster.productId,
          spec: productMaster.spec,
          productName: productMaster.productName,
          productKey: productMaster.productKey,
          defaultUnitPrice: productMaster.defaultUnitPrice,
          qualityFlag: productMaster.qualityFlag,
          category: productMaster.category,
        });

      if (upserted) {
        productMap.set(context.productKeyCandidate, {
          productId: upserted.productId,
          productKey: upserted.productKey,
          productName: upserted.productName,
          spec: upserted.spec ?? null,
          defaultUnitPrice: upserted.defaultUnitPrice ?? null,
          qualityFlag: upserted.qualityFlag,
          category: upserted.category ?? null,
        });
      } else {
        productMap.set(context.productKeyCandidate, {
          productId,
          productKey: context.productKeyCandidate,
          productName: context.productNameRaw,
          spec: context.specRaw,
          defaultUnitPrice: context.unitPrice,
          qualityFlag,
          category: PDF_DEFAULT_CATEGORY,
        });
      }

      const historyProductId = upserted?.productId ?? productId;
      const historyRow = buildUpdateHistoryRow({
        updateKey: `${parseRunId}:${historyProductId}:product_create`,
        productId: historyProductId,
        fieldName: "product_create",
        vendorName,
        beforeValue: null,
        afterValue: context.productKeyCandidate,
        sourceId: parseRunId,
      });
      await tx.insert(updateHistory).values(historyRow);
    }

    lineContexts.forEach((context) => {
      if (!context.matchedProductId) {
        const match = productMap.get(context.productKeyCandidate);
        if (match) {
          context.matchedProductId = match.productId;
          context.matchedProductSpec = match.spec ?? null;
          context.matchedProductCategory = match.category ?? null;
        }
      }
    });

    const lineItemRows = lineContexts.map((context) =>
      buildLineItemRow({ ...context, parseRunId }),
    );
    if (lineItemRows.length) {
      await tx.insert(documentLineItems).values(lineItemRows);
    }

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
        spec: context.specRaw,
        unitPrice: context.unitPrice,
        amount: context.amount,
      };

      if (!context.matchedProductId) {
        const confidence = context.systemConfidenceNum;
        const canCreate = confidence !== null && confidence >= 0.9;
        diffRows.push(
          buildDiffItemRow({
            diffItemId: crypto.randomUUID(),
            parseRunId,
            lineItemId: context.lineItemId,
            classification: canCreate ? "NEW_CANDIDATE" : "UNMATCHED",
            reason: canCreate ? null : "NO_PRODUCT_MATCH",
            vendorName,
            invoiceDate,
            before,
            after,
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
      if (context.matchedProductCategory) {
        before.category = context.matchedProductCategory;
        after.category = context.matchedProductCategory;
      }

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
          lineItemCount: lineContexts.length,
          diffCount: diffRows.length,
          pageCount,
          processedPages: 1,
        },
      })
      .where(eq(documentParseRuns.parseRunId, parseRunId));
  });

  return { parseRunId, status: "SUCCEEDED" };
}
