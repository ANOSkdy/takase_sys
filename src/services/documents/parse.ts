import "server-only";

import { and, eq, inArray, sql } from "drizzle-orm";
import { getEnv } from "@/config/env";
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
import { makeProductKey, normalizeText } from "@/domain/normalize";
import {
  computeSystemConfidence,
  clamp01,
  getBlockedReason,
  isPriceDeviationWithin,
  priceDeviationRatio,
  SPEC_UPDATE_MIN,
  SYSTEM_CONFIDENCE_MIN,
} from "@/domain/update-policy";
import { extractDocumentFromPdf } from "@/services/ai/gemini";
import { PROMPT_VERSION } from "@/services/ai/prompt";
import { getStorageProvider } from "@/services/storage";

export type ParseOutcome =
  | { ok: true; parseRunId: string; status: "RUNNING" }
  | { ok: false; status: number; title: string; detail: string };

export type LineItemRow = {
  lineItemId: string;
  lineNo: number;
  productNameRaw: string | null;
  specRaw: string | null;
  productKeyCandidate: string | null;
  quantity: number | null;
  unitPrice: number | null;
  amount: number | null;
  modelConfidence: number | null;
  systemConfidence: number | null;
  matchedProductId: string | null;
};

export type DiffItemRow = {
  diffItemId: string;
  lineItemId: string;
  lineNo: number;
  productNameRaw: string | null;
  specRaw: string | null;
  systemConfidence: number | null;
  classification: string;
  reason: string | null;
  vendorName: string | null;
  invoiceDate: string | null;
  before: Record<string, unknown>;
  after: Record<string, unknown>;
};

type ParsedLineItem = {
  lineNo: number;
  productNameRaw: string | null;
  specRaw: string | null;
  productKeyCandidate: string | null;
  quantity: number | null;
  unitPrice: number | null;
  amount: number | null;
  modelConfidence: number | null;
  systemConfidence: number;
};

type ProductMatch = {
  productId: string;
  productKey: string;
  productName: string;
  spec: string | null;
};

type VendorPriceRow = {
  vendorPriceId: string;
  productId: string;
  vendorName: string;
  unitPrice: number;
  priceUpdatedOn: string | null;
};

type ClassificationResult = {
  classification: "UPDATE" | "NO_CHANGE" | "UNMATCHED" | "BLOCKED" | "NEW_CANDIDATE";
  reason: string | null;
  priceDeviationRatio: number | null;
};

const dateRegex = /^\d{4}-\d{2}-\d{2}$/;

function parseNumber(value: unknown): number | null {
  if (value == null) return null;
  const num = typeof value === "number" ? value : Number(value);
  return Number.isFinite(num) ? num : null;
}

function parseDateString(value: string | null): string | null {
  if (!value) return null;
  if (!dateRegex.test(value)) return null;
  return value;
}

function makeUpdateKey(
  parseRunId: string,
  productId: string,
  field: string,
  vendorName?: string | null,
) {
  return `${parseRunId}:${productId}:${field}${vendorName ? `:${vendorName}` : ""}`;
}

function buildLineItems(rawItems: Array<unknown>): ParsedLineItem[] {
  const seen = new Set<number>();
  const items: ParsedLineItem[] = [];

  for (const raw of rawItems) {
    if (!raw || typeof raw !== "object") continue;
    const r = raw as Record<string, unknown>;
    const lineNo = parseNumber(r.line_no);
    if (!lineNo || lineNo < 1 || !Number.isInteger(lineNo)) continue;
    if (seen.has(lineNo)) continue;
    seen.add(lineNo);

    const productNameRaw = typeof r.product_name === "string" ? r.product_name.trim() : null;
    const specRaw = typeof r.spec === "string" ? r.spec.trim() : null;
    const quantity = parseNumber(r.quantity);
    const unitPrice = parseNumber(r.unit_price);
    const amount = parseNumber(r.amount);
    const modelConfidence = parseNumber(r.confidence);

    const productKeyCandidate =
      productNameRaw && productNameRaw.length > 0
        ? makeProductKey(productNameRaw, specRaw)
        : null;

    const systemConfidence = computeSystemConfidence({
      productName: productNameRaw,
      spec: specRaw,
      quantity,
      unitPrice,
      amount,
    });

    items.push({
      lineNo,
      productNameRaw,
      specRaw,
      productKeyCandidate,
      quantity,
      unitPrice,
      amount,
      modelConfidence: modelConfidence != null ? clamp01(modelConfidence) : null,
      systemConfidence,
    });
  }

  return items;
}

function classifyLineItem(
  item: ParsedLineItem,
  matchedProduct: ProductMatch | null,
  vendorPrice: VendorPriceRow | null,
  vendorName: string | null,
): ClassificationResult {
  const deviation =
    vendorPrice && item.unitPrice != null
      ? priceDeviationRatio(item.unitPrice, vendorPrice.unitPrice)
      : null;

  if (!matchedProduct) {
    if (item.systemConfidence >= SYSTEM_CONFIDENCE_MIN && item.productKeyCandidate) {
      return { classification: "NEW_CANDIDATE", reason: "NO_MATCH", priceDeviationRatio: null };
    }
    return {
      classification: "UNMATCHED",
      reason: getBlockedReason({
        systemConfidence: item.systemConfidence,
        unitPrice: item.unitPrice,
        productKeyCandidate: item.productKeyCandidate,
      }),
      priceDeviationRatio: null,
    };
  }

  const blockedReason = getBlockedReason({
    systemConfidence: item.systemConfidence,
    unitPrice: item.unitPrice,
    productKeyCandidate: item.productKeyCandidate ?? matchedProduct.productKey,
    priceDeviationRatio: deviation,
  });

  if (blockedReason) {
    return { classification: "BLOCKED", reason: blockedReason, priceDeviationRatio: deviation };
  }

  if (!vendorName) {
    return { classification: "BLOCKED", reason: "MISSING_VENDOR_NAME", priceDeviationRatio: null };
  }

  if (vendorPrice && item.unitPrice != null) {
    if (!isPriceDeviationWithin(item.unitPrice, vendorPrice.unitPrice)) {
      return {
        classification: "BLOCKED",
        reason: "PRICE_DEVIATION_TOO_LARGE",
        priceDeviationRatio: deviation,
      };
    }

    const priceDelta = Math.abs(item.unitPrice - vendorPrice.unitPrice);
    if (priceDelta < 0.01) {
      return { classification: "NO_CHANGE", reason: "PRICE_NO_CHANGE", priceDeviationRatio: 0 };
    }
  }

  return { classification: "UPDATE", reason: null, priceDeviationRatio: deviation };
}

export async function parseDocument(documentId: string): Promise<ParseOutcome> {
  const db = getDb();
  const env = getEnv();
  const model = env.GEMINI_MODEL ?? "gemini-3.0-flash";
  const storage = getStorageProvider();

  const [doc] = await db
    .select({
      documentId: documents.documentId,
      storageKey: documents.storageKey,
      isDeleted: documents.isDeleted,
      vendorName: documents.vendorName,
    })
    .from(documents)
    .where(eq(documents.documentId, documentId))
    .limit(1);

  if (!doc) {
    return { ok: false, status: 404, title: "Not Found", detail: "Document not found" };
  }

  if (doc.isDeleted) {
    return { ok: false, status: 409, title: "Conflict", detail: "Document is deleted" };
  }

  const parseRunId = crypto.randomUUID();
  const startedAt = new Date();

  await db.transaction(async (tx) => {
    await tx
      .update(documents)
      .set({ status: "PARSING", parseErrorSummary: null })
      .where(eq(documents.documentId, documentId));

    await tx.insert(documentParseRuns).values({
      parseRunId,
      documentId,
      startedAt,
      status: "RUNNING",
      model,
      promptVersion: PROMPT_VERSION,
      stats: {},
      errorDetail: null,
    });
  });

  try {
    const getDownloadUrl = storage.getDownloadUrl;
    if (!getDownloadUrl) {
      throw new Error("Storage provider does not support download URLs");
    }
    const downloadUrl = await getDownloadUrl(doc.storageKey);
    const headers: Record<string, string> = {};
    if (env.BLOB_READ_WRITE_TOKEN) {
      headers.authorization = `Bearer ${env.BLOB_READ_WRITE_TOKEN}`;
    }
    const response = await fetch(downloadUrl, { headers });
    if (!response.ok) {
      throw new Error(`PDF download failed: ${response.status}`);
    }
    const pdfBuffer = await response.arrayBuffer();
    const header = new TextDecoder().decode(pdfBuffer.slice(0, 5));
    if (!header.startsWith("%PDF-")) {
      throw new Error("Invalid PDF header");
    }

    const aiResult = await extractDocumentFromPdf(pdfBuffer);
    if (!aiResult.ok) {
      throw new Error(aiResult.errorSummary);
    }

    const normalizedVendor = aiResult.data.vendor_name
      ? normalizeText(aiResult.data.vendor_name)
      : null;
    const vendorName = normalizedVendor || doc.vendorName;
    const invoiceDate = parseDateString(aiResult.data.invoice_date);
    const parsedItems = buildLineItems(aiResult.data.line_items as Array<unknown>);

    await db.transaction(async (tx) => {
      if (vendorName || invoiceDate) {
        await tx
          .update(documents)
          .set({
            vendorName: vendorName ?? null,
            invoiceDate: invoiceDate ?? null,
          })
          .where(eq(documents.documentId, documentId));
      }

      type LineItemInsert = typeof documentLineItems.$inferInsert;
      const lineItemRows: LineItemInsert[] = parsedItems.map((item) => ({
        lineItemId: crypto.randomUUID(),
        parseRunId,
        lineNo: item.lineNo,
        productNameRaw: item.productNameRaw,
        specRaw: item.specRaw,
        productKeyCandidate: item.productKeyCandidate,
        quantity: item.quantity,
        unitPrice: item.unitPrice,
        amount: item.amount,
        modelConfidence: item.modelConfidence,
        systemConfidence: item.systemConfidence,
        matchedProductId: null,
      }));

      if (lineItemRows.length > 0) {
        await tx.insert(documentLineItems).values(lineItemRows);
      }

      const candidateKeys = Array.from(
        new Set(lineItemRows.map((row) => row.productKeyCandidate).filter(Boolean)),
      ) as string[];

      const matches = candidateKeys.length
        ? await tx
            .select({
              productId: productMaster.productId,
              productKey: productMaster.productKey,
              productName: productMaster.productName,
              spec: productMaster.spec,
            })
            .from(productMaster)
            .where(inArray(productMaster.productKey, candidateKeys))
        : [];

      const matchMap = new Map(matches.map((m) => [m.productKey, m]));

      for (const row of lineItemRows) {
        const match = row.productKeyCandidate ? matchMap.get(row.productKeyCandidate) : null;
        if (!match) continue;
        await tx
          .update(documentLineItems)
          .set({ matchedProductId: match.productId })
          .where(eq(documentLineItems.lineItemId, row.lineItemId));
      }

      const matchedProductIds = matches.map((m) => m.productId);
      const vendorPriceRows = vendorName && matchedProductIds.length
        ? await tx
            .select({
              vendorPriceId: vendorPrices.vendorPriceId,
              productId: vendorPrices.productId,
              vendorName: vendorPrices.vendorName,
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

      const vendorPriceNormalized: VendorPriceRow[] = vendorPriceRows.map((vp) => ({
        ...vp,
        unitPrice: Number(vp.unitPrice),
        priceUpdatedOn: vp.priceUpdatedOn ? String(vp.priceUpdatedOn).slice(0, 10) : null,
      }));

      const vendorPriceMap = new Map(
        vendorPriceNormalized.map((vp) => [`${vp.productId}:${vp.vendorName}`, vp]),
      );

      const diffRows: Array<typeof documentDiffItems.$inferInsert> = [];
      const updates: Array<{
        lineItemId: string;
        product: ProductMatch;
        vendorPrice: VendorPriceRow | null;
        item: ParsedLineItem;
        classification: ClassificationResult;
      }> = [];

      const lineItemById = new Map(
        lineItemRows.map((row, idx) => [row.lineItemId, parsedItems[idx]]),
      );

      for (const row of lineItemRows) {
        const parsed = lineItemById.get(row.lineItemId);
        if (!parsed) continue;
        const matched = row.productKeyCandidate ? matchMap.get(row.productKeyCandidate) : null;
        const vendorPrice = matched
          ? vendorPriceMap.get(`${matched.productId}:${vendorName ?? ""}`) ?? null
          : null;
        const classification = classifyLineItem(parsed, matched ?? null, vendorPrice, vendorName ?? null);

        diffRows.push({
          diffItemId: crypto.randomUUID(),
          parseRunId,
          lineItemId: row.lineItemId,
          classification: classification.classification,
          reason: classification.reason,
          vendorName: vendorName ?? null,
          invoiceDate: invoiceDate ?? null,
          before: {
            product_id: matched?.productId ?? null,
            product_key: matched?.productKey ?? null,
            spec: matched?.spec ?? null,
            vendor_price: vendorPrice
              ? {
                  vendor_name: vendorPrice.vendorName,
                  unit_price: vendorPrice.unitPrice,
                  price_updated_on: vendorPrice.priceUpdatedOn,
                }
              : null,
          },
          after: {
            product_id: matched?.productId ?? null,
            product_key: parsed.productKeyCandidate ?? null,
            spec: parsed.specRaw ?? null,
            vendor_price:
              parsed.unitPrice != null
                ? {
                    vendor_name: vendorName ?? null,
                    unit_price: parsed.unitPrice,
                    price_updated_on: invoiceDate ?? null,
                  }
                : null,
          },
        });

        if (matched && classification.classification === "UPDATE") {
          updates.push({
            lineItemId: row.lineItemId,
            product: matched,
            vendorPrice,
            item: parsed,
            classification,
          });
        }
      }

      if (diffRows.length > 0) {
        await tx.insert(documentDiffItems).values(diffRows);
      }

      for (const row of lineItemRows) {
        if (row.matchedProductId) continue;
        const parsed = lineItemById.get(row.lineItemId);
        if (!parsed) continue;
        if (!parsed.productKeyCandidate || parsed.systemConfidence < SPEC_UPDATE_MIN) continue;
        if (!parsed.productNameRaw) continue;

        const [created] = await tx
          .insert(productMaster)
          .values({
            productId: crypto.randomUUID(),
            productKey: parsed.productKeyCandidate,
            productName: parsed.productNameRaw,
            spec: parsed.specRaw,
            category: null,
            defaultUnitPrice: parsed.unitPrice ?? null,
            qualityFlag: "WARN_NEW_FROM_PDF",
            lastUpdatedAt: new Date(),
            lastSourceType: "PDF",
            lastSourceId: parseRunId,
          })
          .onConflictDoUpdate({
            target: productMaster.productKey,
            set: {
              productName: sql`excluded.product_name`,
              spec: sql`excluded.spec`,
              lastUpdatedAt: new Date(),
              lastSourceType: "PDF",
              lastSourceId: parseRunId,
            },
          })
          .returning({
            productId: productMaster.productId,
            productKey: productMaster.productKey,
            productName: productMaster.productName,
            spec: productMaster.spec,
          });

        if (!created) continue;

        await tx
          .update(documentLineItems)
          .set({ matchedProductId: created.productId })
          .where(eq(documentLineItems.lineItemId, row.lineItemId));

        await tx
          .update(documentDiffItems)
          .set({ reason: "AUTO_CREATED" })
          .where(
            and(
              eq(documentDiffItems.parseRunId, parseRunId),
              eq(documentDiffItems.lineItemId, row.lineItemId),
            ),
          );

        await tx
          .insert(updateHistory)
          .values({
            historyId: crypto.randomUUID(),
            updateKey: makeUpdateKey(parseRunId, created.productId, "product_create"),
            productId: created.productId,
            fieldName: "product_create",
            vendorName: null,
            beforeValue: null,
            afterValue: JSON.stringify({ product_key: created.productKey }),
            sourceType: "PDF",
            sourceId: parseRunId,
            updatedAt: new Date(),
            updatedBy: "SYSTEM",
          })
          .onConflictDoNothing();

        if (vendorName && parsed.unitPrice != null) {
          const priceUpdatedOn = invoiceDate ?? null;
          await tx
            .insert(vendorPrices)
            .values({
              vendorPriceId: crypto.randomUUID(),
              productId: created.productId,
              vendorName,
              unitPrice: parsed.unitPrice,
              priceUpdatedOn,
              sourceType: "PDF",
              sourceId: parseRunId,
              updatedAt: new Date(),
            })
            .onConflictDoUpdate({
              target: [vendorPrices.productId, vendorPrices.vendorName],
              set: {
                unitPrice: parsed.unitPrice,
                priceUpdatedOn,
                sourceType: "PDF",
                sourceId: parseRunId,
                updatedAt: new Date(),
              },
              where:
                priceUpdatedOn != null
                  ? sql`${vendorPrices.priceUpdatedOn} IS NULL OR ${vendorPrices.priceUpdatedOn} <= ${priceUpdatedOn}`
                  : sql`${vendorPrices.priceUpdatedOn} IS NULL`,
            });

          await tx
            .insert(updateHistory)
            .values({
              historyId: crypto.randomUUID(),
              updateKey: makeUpdateKey(parseRunId, created.productId, "vendor_price", vendorName),
              productId: created.productId,
              fieldName: "vendor_price",
              vendorName,
              beforeValue: null,
              afterValue: JSON.stringify({
                vendor_name: vendorName,
                unit_price: parsed.unitPrice,
                price_updated_on: priceUpdatedOn,
              }),
              sourceType: "PDF",
              sourceId: parseRunId,
              updatedAt: new Date(),
              updatedBy: "SYSTEM",
            })
            .onConflictDoNothing();
        }
      }

      for (const update of updates) {
        const { product, vendorPrice, item } = update;
        const unitPrice = item.unitPrice;
        if (unitPrice == null || !vendorName) continue;

        const priceUpdatedOn = invoiceDate ?? null;
        const updateKey = makeUpdateKey(parseRunId, product.productId, "vendor_price", vendorName);

        const shouldUpdateSpec =
          item.specRaw && item.systemConfidence >= SPEC_UPDATE_MIN ? item.specRaw : null;

        const upsertSet: typeof vendorPrices.$inferInsert = {
          vendorPriceId: vendorPrice?.vendorPriceId ?? crypto.randomUUID(),
          productId: product.productId,
          vendorName,
          unitPrice,
          priceUpdatedOn,
          sourceType: "PDF",
          sourceId: parseRunId,
          updatedAt: new Date(),
        };

        const conflict = tx
          .insert(vendorPrices)
          .values(upsertSet)
          .onConflictDoUpdate({
            target: [vendorPrices.productId, vendorPrices.vendorName],
            set: {
              unitPrice,
              priceUpdatedOn,
              sourceType: "PDF",
              sourceId: parseRunId,
              updatedAt: new Date(),
            },
            where:
              priceUpdatedOn != null
                ? sql`${vendorPrices.priceUpdatedOn} IS NULL OR ${vendorPrices.priceUpdatedOn} <= ${priceUpdatedOn}`
                : sql`${vendorPrices.priceUpdatedOn} IS NULL`,
          });

        await conflict;

        await tx
          .insert(updateHistory)
          .values({
            historyId: crypto.randomUUID(),
            updateKey,
            productId: product.productId,
            fieldName: "vendor_price",
            vendorName,
            beforeValue: vendorPrice ? JSON.stringify(vendorPrice) : null,
            afterValue: JSON.stringify({
              vendor_name: vendorName,
              unit_price: unitPrice,
              price_updated_on: priceUpdatedOn,
            }),
            sourceType: "PDF",
            sourceId: parseRunId,
            updatedAt: new Date(),
            updatedBy: "SYSTEM",
          })
          .onConflictDoNothing();

        if (shouldUpdateSpec) {
          await tx
            .update(productMaster)
            .set({
              spec: shouldUpdateSpec,
              lastUpdatedAt: new Date(),
              lastSourceType: "PDF",
              lastSourceId: parseRunId,
            })
            .where(eq(productMaster.productId, product.productId));

          await tx
            .insert(updateHistory)
            .values({
              historyId: crypto.randomUUID(),
              updateKey: makeUpdateKey(parseRunId, product.productId, "spec"),
              productId: product.productId,
              fieldName: "spec",
              vendorName: null,
              beforeValue: product.spec,
              afterValue: shouldUpdateSpec,
              sourceType: "PDF",
              sourceId: parseRunId,
              updatedAt: new Date(),
              updatedBy: "SYSTEM",
            })
            .onConflictDoNothing();
        }
      }

      const summary = diffRows.reduce(
        (acc, row) => {
          acc.total += 1;
          if (row.classification === "UPDATE") acc.update += 1;
          if (row.classification === "BLOCKED") acc.blocked += 1;
          if (row.classification === "UNMATCHED") acc.unmatched += 1;
          if (row.classification === "NO_CHANGE") acc.noChange += 1;
          if (row.classification === "NEW_CANDIDATE") acc.newCandidate += 1;
          return acc;
        },
        { total: 0, update: 0, blocked: 0, unmatched: 0, noChange: 0, newCandidate: 0 },
      );

      await tx
        .update(documentParseRuns)
        .set({
          status: "SUCCEEDED",
          finishedAt: new Date(),
          stats: summary,
        })
        .where(eq(documentParseRuns.parseRunId, parseRunId));

      await tx
        .update(documents)
        .set({ status: "PARSED", parseErrorSummary: null })
        .where(eq(documents.documentId, documentId));
    });

    return { ok: true, parseRunId, status: "RUNNING" };
  } catch (error) {
    const errorSummary = error instanceof Error ? error.message.slice(0, 200) : "Parse failed";
    await db.transaction(async (tx) => {
      await tx
        .update(documentParseRuns)
        .set({
          status: "FAILED",
          finishedAt: new Date(),
          errorDetail: errorSummary,
        })
        .where(eq(documentParseRuns.parseRunId, parseRunId));
      await tx
        .update(documents)
        .set({ status: "FAILED", parseErrorSummary: errorSummary })
        .where(eq(documents.documentId, documentId));
    });

    return { ok: false, status: 500, title: "Internal Server Error", detail: errorSummary };
  }
}

export async function listLineItems(documentId: string, parseRunId: string): Promise<LineItemRow[]> {
  const db = getDb();
  const rows = await db
    .select({
      lineItemId: documentLineItems.lineItemId,
      lineNo: documentLineItems.lineNo,
      productNameRaw: documentLineItems.productNameRaw,
      specRaw: documentLineItems.specRaw,
      productKeyCandidate: documentLineItems.productKeyCandidate,
      quantity: documentLineItems.quantity,
      unitPrice: documentLineItems.unitPrice,
      amount: documentLineItems.amount,
      modelConfidence: documentLineItems.modelConfidence,
      systemConfidence: documentLineItems.systemConfidence,
      matchedProductId: documentLineItems.matchedProductId,
    })
    .from(documentLineItems)
    .innerJoin(documentParseRuns, eq(documentParseRuns.parseRunId, documentLineItems.parseRunId))
    .where(
      and(
        eq(documentParseRuns.documentId, documentId),
        eq(documentLineItems.parseRunId, parseRunId),
      ),
    )
    .orderBy(documentLineItems.lineNo);

  return rows.map((row) => ({
    lineItemId: row.lineItemId,
    lineNo: row.lineNo,
    productNameRaw: row.productNameRaw ?? null,
    specRaw: row.specRaw ?? null,
    productKeyCandidate: row.productKeyCandidate ?? null,
    quantity: row.quantity != null ? Number(row.quantity) : null,
    unitPrice: row.unitPrice != null ? Number(row.unitPrice) : null,
    amount: row.amount != null ? Number(row.amount) : null,
    modelConfidence: row.modelConfidence != null ? Number(row.modelConfidence) : null,
    systemConfidence: row.systemConfidence != null ? Number(row.systemConfidence) : null,
    matchedProductId: row.matchedProductId ?? null,
  }));
}

export async function listDiffItems(
  documentId: string,
  parseRunId: string,
  classification?: string | null,
): Promise<DiffItemRow[]> {
  const db = getDb();
  const rows = await db
    .select({
      diffItemId: documentDiffItems.diffItemId,
      lineItemId: documentDiffItems.lineItemId,
      lineNo: documentLineItems.lineNo,
      productNameRaw: documentLineItems.productNameRaw,
      specRaw: documentLineItems.specRaw,
      systemConfidence: documentLineItems.systemConfidence,
      classification: documentDiffItems.classification,
      reason: documentDiffItems.reason,
      vendorName: documentDiffItems.vendorName,
      invoiceDate: documentDiffItems.invoiceDate,
      before: documentDiffItems.before,
      after: documentDiffItems.after,
    })
    .from(documentDiffItems)
    .innerJoin(documentLineItems, eq(documentLineItems.lineItemId, documentDiffItems.lineItemId))
    .innerJoin(documentParseRuns, eq(documentParseRuns.parseRunId, documentDiffItems.parseRunId))
    .where(
      and(
        eq(documentParseRuns.documentId, documentId),
        eq(documentDiffItems.parseRunId, parseRunId),
        classification ? eq(documentDiffItems.classification, classification) : sql`true`,
      ),
    )
    .orderBy(documentDiffItems.classification, documentDiffItems.lineItemId);

  return rows.map((row) => ({
    diffItemId: row.diffItemId,
    lineItemId: row.lineItemId,
    lineNo: row.lineNo,
    productNameRaw: row.productNameRaw ?? null,
    specRaw: row.specRaw ?? null,
    systemConfidence: row.systemConfidence != null ? Number(row.systemConfidence) : null,
    classification: row.classification,
    reason: row.reason ?? null,
    vendorName: row.vendorName ?? null,
    invoiceDate: row.invoiceDate ? String(row.invoiceDate).slice(0, 10) : null,
    before: row.before as Record<string, unknown>,
    after: row.after as Record<string, unknown>,
  }));
}

export async function diffSummary(
  documentId: string,
  parseRunId: string,
): Promise<{ update: number; blocked: number; unmatched: number; noChange: number; newCandidate: number }> {
  const db = getDb();
  const rows = await db
    .select({
      classification: documentDiffItems.classification,
      count: sql<number>`count(*)`.as("count"),
    })
    .from(documentDiffItems)
    .innerJoin(documentParseRuns, eq(documentParseRuns.parseRunId, documentDiffItems.parseRunId))
    .where(
      and(
        eq(documentParseRuns.documentId, documentId),
        eq(documentDiffItems.parseRunId, parseRunId),
      ),
    )
    .groupBy(documentDiffItems.classification);

  const summary = { update: 0, blocked: 0, unmatched: 0, noChange: 0, newCandidate: 0 };
  for (const row of rows) {
    const count = Number(row.count);
    switch (row.classification) {
      case "UPDATE":
        summary.update = count;
        break;
      case "BLOCKED":
        summary.blocked = count;
        break;
      case "UNMATCHED":
        summary.unmatched = count;
        break;
      case "NO_CHANGE":
        summary.noChange = count;
        break;
      case "NEW_CANDIDATE":
        summary.newCandidate = count;
        break;
    }
  }
  return summary;
}
