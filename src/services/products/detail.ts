import "server-only";
import { desc, eq } from "drizzle-orm";
import { getDb } from "@/db/client";
import { productMaster, updateHistory, vendorPrices } from "@/db/schema";

export type VendorPriceDetail = {
  vendorPriceId: string;
  vendorName: string;
  unitPrice: number;
  priceUpdatedOn: string | null;
  updatedAt: string;
  sourceType: string;
  sourceId: string;
};

export type UpdateHistoryItem = {
  historyId: string;
  updateKey: string;
  fieldName: string;
  vendorName: string | null;
  beforeValue: string | null;
  afterValue: string | null;
  sourceType: string;
  sourceId: string;
  updatedAt: string;
  updatedBy: string | null;
};

export type ProductDetail = {
  productId: string;
  productKey: string;
  productName: string;
  spec: string | null;
  category: string | null;
  defaultUnitPrice: number | null;
  qualityFlag: string;
  lastUpdatedAt: string;
  lastSourceType: string | null;
  lastSourceId: string | null;
  vendorPrices: VendorPriceDetail[];
  updateHistory: UpdateHistoryItem[];
};

function toIso(value: Date | string | null): string | null {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return date.toISOString();
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
      lastSourceType: productMaster.lastSourceType,
      lastSourceId: productMaster.lastSourceId,
    })
    .from(productMaster)
    .where(eq(productMaster.productId, productId))
    .limit(1);

  if (!product) return null;

  const [vendorRows, historyRows] = await Promise.all([
    db
      .select({
        vendorPriceId: vendorPrices.vendorPriceId,
        vendorName: vendorPrices.vendorName,
        unitPrice: vendorPrices.unitPrice,
        priceUpdatedOn: vendorPrices.priceUpdatedOn,
        updatedAt: vendorPrices.updatedAt,
        sourceType: vendorPrices.sourceType,
        sourceId: vendorPrices.sourceId,
      })
      .from(vendorPrices)
      .where(eq(vendorPrices.productId, productId)),
    db
      .select({
        historyId: updateHistory.historyId,
        updateKey: updateHistory.updateKey,
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
      .limit(50),
  ]);

  return {
    productId: product.productId,
    productKey: product.productKey,
    productName: product.productName,
    spec: product.spec ?? null,
    category: product.category ?? null,
    defaultUnitPrice: product.defaultUnitPrice != null ? Number(product.defaultUnitPrice) : null,
    qualityFlag: product.qualityFlag,
    lastUpdatedAt: toIso(product.lastUpdatedAt) ?? "",
    lastSourceType: product.lastSourceType ?? null,
    lastSourceId: product.lastSourceId ?? null,
    vendorPrices: vendorRows.map((row) => ({
      vendorPriceId: row.vendorPriceId,
      vendorName: row.vendorName,
      unitPrice: Number(row.unitPrice),
      priceUpdatedOn: row.priceUpdatedOn ? String(row.priceUpdatedOn).slice(0, 10) : null,
      updatedAt: toIso(row.updatedAt) ?? "",
      sourceType: row.sourceType,
      sourceId: row.sourceId,
    })),
    updateHistory: historyRows.map((row) => ({
      historyId: row.historyId,
      updateKey: row.updateKey,
      fieldName: row.fieldName,
      vendorName: row.vendorName ?? null,
      beforeValue: row.beforeValue ?? null,
      afterValue: row.afterValue ?? null,
      sourceType: row.sourceType,
      sourceId: row.sourceId,
      updatedAt: toIso(row.updatedAt) ?? "",
      updatedBy: row.updatedBy ?? null,
    })),
  };
}
