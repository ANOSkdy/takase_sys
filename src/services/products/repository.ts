import "server-only";
import { and, desc, eq, ilike, inArray, ne, or, type SQL } from "drizzle-orm";
import { getDb } from "@/db/client";
import { productMaster, updateHistory, vendorPrices } from "@/db/schema";
import { toReviewStatus } from "@/domain/review-status";
import { getProductSourceSummaries, listProductSources } from "@/services/products/sources";
import type {
  ProductDetail,
  ProductListItem,
  ProductUpdateHistory,
  ProductVendorPrice,
} from "@/services/products/types";

function toIsoString(value: Date | string | null): string | null {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return typeof value === "string" ? value : null;
  return date.toISOString();
}

function toDateString(value: Date | string | null): string | null {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return typeof value === "string" ? value : null;
  return date.toISOString().slice(0, 10);
}

export type ProductListFilters = {
  keyword?: string | null;
  category?: string | null;
  vendorName?: string | null;
  qualityFlag?: string | null;
  limit?: number | null;
  offset?: number | null;
};

export async function listProducts(filters: ProductListFilters = {}): Promise<ProductListItem[]> {
  const db = getDb();
  // 統合済みは通常の一覧・検索・手動紐付け候補から除外する。
  const conditions: (SQL | undefined)[] = [ne(productMaster.reviewStatus, "MERGED")];

  if (filters.keyword) {
    const keyword = `%${filters.keyword}%`;
    conditions.push(
      or(
        ilike(productMaster.productName, keyword),
        ilike(productMaster.productKey, keyword),
        ilike(productMaster.spec, keyword),
      ),
    );
  }

  if (filters.category) {
    conditions.push(eq(productMaster.category, filters.category));
  }

  if (filters.qualityFlag) {
    conditions.push(eq(productMaster.qualityFlag, filters.qualityFlag));
  }

  if (filters.vendorName) {
    const vendorRows = await db
      .select({ productId: vendorPrices.productId })
      .from(vendorPrices)
      .where(eq(vendorPrices.vendorName, filters.vendorName));
    const productIds = vendorRows.map((row) => row.productId);
    if (productIds.length === 0) return [];
    conditions.push(inArray(productMaster.productId, productIds));
  }

  const baseQuery = db
    .select({
      productId: productMaster.productId,
      productKey: productMaster.productKey,
      productName: productMaster.productName,
      spec: productMaster.spec,
      category: productMaster.category,
      defaultUnitPrice: productMaster.defaultUnitPrice,
      qualityFlag: productMaster.qualityFlag,
      reviewStatus: productMaster.reviewStatus,
      lastUpdatedAt: productMaster.lastUpdatedAt,
    })
    .from(productMaster);

  const filteredQuery = baseQuery.where(and(...conditions));
  const orderedQuery = filteredQuery.orderBy(desc(productMaster.lastUpdatedAt));
  const limitedQuery = filters.limit ? orderedQuery.limit(filters.limit) : orderedQuery;
  const finalQuery = filters.offset ? limitedQuery.offset(filters.offset) : limitedQuery;

  const rows = await finalQuery;
  const sourceSummaries = await getProductSourceSummaries(rows.map((row) => row.productId));

  return rows.map((row) => ({
    productId: row.productId,
    productKey: row.productKey,
    productName: row.productName,
    spec: row.spec ?? null,
    category: row.category ?? null,
    defaultUnitPrice: row.defaultUnitPrice ?? null,
    qualityFlag: row.qualityFlag,
    reviewStatus: toReviewStatus(row.reviewStatus),
    lastUpdatedAt: toIsoString(row.lastUpdatedAt) ?? "",
    sourceSummary: sourceSummaries.get(row.productId) ?? null,
  }));
}

export async function getProductDetail(productId: string): Promise<ProductDetail | null> {
  const db = getDb();
  const [product] = await db
    .select({
      productId: productMaster.productId,
      productKey: productMaster.productKey,
      productName: productMaster.productName,
      spec: productMaster.spec,
      category: productMaster.category,
      defaultUnitPrice: productMaster.defaultUnitPrice,
      qualityFlag: productMaster.qualityFlag,
      reviewStatus: productMaster.reviewStatus,
      reviewedAt: productMaster.reviewedAt,
      reviewedBy: productMaster.reviewedBy,
      mergedIntoProductId: productMaster.mergedIntoProductId,
      lastUpdatedAt: productMaster.lastUpdatedAt,
    })
    .from(productMaster)
    .where(eq(productMaster.productId, productId))
    .limit(1);

  if (!product) return null;

  // 統合済み商品へ直接アクセスされた場合に統合先を案内する。
  let mergedInto: ProductDetail["mergedInto"] = null;
  if (product.mergedIntoProductId) {
    const [target] = await db
      .select({ productId: productMaster.productId, productName: productMaster.productName })
      .from(productMaster)
      .where(eq(productMaster.productId, product.mergedIntoProductId))
      .limit(1);
    mergedInto = target ?? null;
  }

  const sources = await listProductSources(productId);

  const vendorRows = await db
    .select({
      vendorPriceId: vendorPrices.vendorPriceId,
      vendorName: vendorPrices.vendorName,
      unitPrice: vendorPrices.unitPrice,
      priceUpdatedOn: vendorPrices.priceUpdatedOn,
      updatedAt: vendorPrices.updatedAt,
    })
    .from(vendorPrices)
    .where(eq(vendorPrices.productId, productId))
    .orderBy(desc(vendorPrices.updatedAt));

  const vendorPricesList: ProductVendorPrice[] = vendorRows.map((row) => ({
    vendorPriceId: row.vendorPriceId,
    vendorName: row.vendorName,
    unitPrice: row.unitPrice,
    priceUpdatedOn: toDateString(row.priceUpdatedOn),
    updatedAt: toIsoString(row.updatedAt) ?? "",
  }));

  const historyRows = await db
    .select({
      historyId: updateHistory.historyId,
      fieldName: updateHistory.fieldName,
      vendorName: updateHistory.vendorName,
      beforeValue: updateHistory.beforeValue,
      afterValue: updateHistory.afterValue,
      sourceType: updateHistory.sourceType,
      sourceId: updateHistory.sourceId,
      updatedAt: updateHistory.updatedAt,
      updatedBy: updateHistory.updatedBy,
    })
    .from(updateHistory)
    .where(eq(updateHistory.productId, productId))
    .orderBy(desc(updateHistory.updatedAt))
    .limit(50);

  const updateHistoryList: ProductUpdateHistory[] = historyRows.map((row) => ({
    historyId: row.historyId,
    fieldName: row.fieldName,
    vendorName: row.vendorName ?? null,
    beforeValue: row.beforeValue ?? null,
    afterValue: row.afterValue ?? null,
    sourceType: row.sourceType,
    sourceId: row.sourceId,
    updatedAt: toIsoString(row.updatedAt) ?? "",
    updatedBy: row.updatedBy ?? null,
  }));

  return {
    productId: product.productId,
    productKey: product.productKey,
    productName: product.productName,
    spec: product.spec ?? null,
    category: product.category ?? null,
    defaultUnitPrice: product.defaultUnitPrice ?? null,
    qualityFlag: product.qualityFlag,
    reviewStatus: toReviewStatus(product.reviewStatus),
    reviewedAt: toIsoString(product.reviewedAt),
    reviewedBy: product.reviewedBy ?? null,
    mergedInto,
    sources,
    lastUpdatedAt: toIsoString(product.lastUpdatedAt) ?? "",
    vendorPrices: vendorPricesList,
    updateHistory: updateHistoryList,
  };
}
