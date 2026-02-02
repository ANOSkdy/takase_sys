import "server-only";
import { desc, eq } from "drizzle-orm";
import { getDb } from "@/db/client";
import { productMaster, vendorPrices } from "@/db/schema";
import type { ProductDetail, ProductListItem, ProductVendorPrice } from "@/services/products/types";

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

export async function listProducts(): Promise<ProductListItem[]> {
  const db = getDb();
  const rows = await db
    .select({
      productId: productMaster.productId,
      productKey: productMaster.productKey,
      productName: productMaster.productName,
      spec: productMaster.spec,
      category: productMaster.category,
      defaultUnitPrice: productMaster.defaultUnitPrice,
      lastUpdatedAt: productMaster.lastUpdatedAt,
    })
    .from(productMaster)
    .orderBy(desc(productMaster.lastUpdatedAt));

  return rows.map((row) => ({
    productId: row.productId,
    productKey: row.productKey,
    productName: row.productName,
    spec: row.spec ?? null,
    category: row.category ?? null,
    defaultUnitPrice: row.defaultUnitPrice ?? null,
    lastUpdatedAt: toIsoString(row.lastUpdatedAt) ?? "",
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

  return {
    productId: product.productId,
    productKey: product.productKey,
    productName: product.productName,
    spec: product.spec ?? null,
    category: product.category ?? null,
    defaultUnitPrice: product.defaultUnitPrice ?? null,
    lastUpdatedAt: toIsoString(product.lastUpdatedAt) ?? "",
    vendorPrices: vendorPricesList,
  };
}
