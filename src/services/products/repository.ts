import "server-only";
import { and, desc, eq, ilike, inArray, or, sql } from "drizzle-orm";
import type { SQL } from "drizzle-orm";
import { getDb } from "@/db/client";
import { productMaster, updateHistory, vendorPrices } from "@/db/schema";
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
  keyword?: string;
  category?: string;
  vendor?: string;
  qualityFlag?: string;
  page?: number;
  pageSize?: number;
};

export type ProductListResult = {
  items: ProductListItem[];
  total: number;
  page: number;
  pageSize: number;
};

export async function listProducts(filters: ProductListFilters = {}): Promise<ProductListResult> {
  const db = getDb();
  const page = Math.max(filters.page ?? 1, 1);
  const pageSize = Math.min(Math.max(filters.pageSize ?? 50, 1), 200);
  const offset = (page - 1) * pageSize;

  const conditions: SQL[] = [];
  if (filters.keyword) {
    const pattern = `%${filters.keyword}%`;
    const keywordCondition = or(
      ilike(productMaster.productName, pattern),
      ilike(productMaster.productKey, pattern),
      ilike(productMaster.spec, pattern),
    );
    if (keywordCondition) {
      conditions.push(keywordCondition);
    }
  }
  if (filters.category) {
    conditions.push(eq(productMaster.category, filters.category));
  }
  if (filters.qualityFlag) {
    conditions.push(eq(productMaster.qualityFlag, filters.qualityFlag));
  }
  if (filters.vendor) {
    const vendorPattern = `%${filters.vendor}%`;
    const vendorProductIds = db
      .select({ productId: vendorPrices.productId })
      .from(vendorPrices)
      .where(ilike(vendorPrices.vendorName, vendorPattern));
    conditions.push(inArray(productMaster.productId, vendorProductIds));
  }

  const whereClause = conditions.length ? and(...conditions) : undefined;
  const rows = await db
    .select({
      productId: productMaster.productId,
      productKey: productMaster.productKey,
      productName: productMaster.productName,
      spec: productMaster.spec,
      category: productMaster.category,
      defaultUnitPrice: productMaster.defaultUnitPrice,
      qualityFlag: productMaster.qualityFlag,
      lastUpdatedAt: productMaster.lastUpdatedAt,
    })
    .from(productMaster)
    .where(whereClause)
    .orderBy(desc(productMaster.lastUpdatedAt))
    .limit(pageSize)
    .offset(offset);

  const [{ total }] = await db
    .select({ total: sql<number>`count(*)` })
    .from(productMaster)
    .where(whereClause);

  const items = rows.map((row) => ({
    productId: row.productId,
    productKey: row.productKey,
    productName: row.productName,
    spec: row.spec ?? null,
    category: row.category ?? null,
    defaultUnitPrice: row.defaultUnitPrice ?? null,
    qualityFlag: row.qualityFlag,
    lastUpdatedAt: toIsoString(row.lastUpdatedAt) ?? "",
  }));

  return {
    items,
    total: total ?? 0,
    page,
    pageSize,
  };
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
      lastUpdatedAt: productMaster.lastUpdatedAt,
    })
    .from(productMaster)
    .where(eq(productMaster.productId, productId))
    .limit(1);

  if (!product) return null;

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
      updateKey: updateHistory.updateKey,
      fieldName: updateHistory.fieldName,
      vendorName: updateHistory.vendorName,
      beforeValue: updateHistory.beforeValue,
      afterValue: updateHistory.afterValue,
      updatedAt: updateHistory.updatedAt,
      updatedBy: updateHistory.updatedBy,
    })
    .from(updateHistory)
    .where(eq(updateHistory.productId, productId))
    .orderBy(desc(updateHistory.updatedAt))
    .limit(50);

  const updateHistoryList: ProductUpdateHistory[] = historyRows.map((row) => ({
    historyId: row.historyId,
    updateKey: row.updateKey,
    fieldName: row.fieldName,
    vendorName: row.vendorName ?? null,
    beforeValue: row.beforeValue ?? null,
    afterValue: row.afterValue ?? null,
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
    lastUpdatedAt: toIsoString(product.lastUpdatedAt) ?? "",
    vendorPrices: vendorPricesList,
    updateHistory: updateHistoryList,
  };
}
