import "server-only";
import { getSql } from "@/db/client";

export type ProductSheetCategory = {
  category: string;
  productCount: number;
  vendorCount: number;
};

export type ProductSheetVendor = {
  vendorName: string;
};

export type ProductSheetPrice = {
  vendorPriceId: string;
  unitPrice: string | number;
  priceUpdatedOn: string | Date | null;
  updatedAt: string | Date | null;
};

export type ProductSheetRow = {
  productId: string;
  productName: string;
  productMaker: string | null;
  spec: string | null;
  qualityFlag: string;
  lastUpdatedAt: string | Date | null;
  prices: Record<string, ProductSheetPrice>;
};

export type ProductSheetGrid = {
  category: string;
  vendors: ProductSheetVendor[];
  rows: ProductSheetRow[];
};

type CategoryRow = {
  category: string;
  productCount: string | number;
  vendorCount: string | number;
};

type GridRow = {
  productId: string;
  productName: string;
  productMaker: string | null;
  spec: string | null;
  category: string | null;
  qualityFlag: string;
  lastUpdatedAt: string | Date | null;
  vendorPriceId: string | null;
  vendorName: string | null;
  unitPrice: string | number | null;
  priceUpdatedOn: string | Date | null;
  updatedAt: string | Date | null;
};

export async function listProductSheetCategories(): Promise<ProductSheetCategory[]> {
  const sql = getSql();
  const rows = await sql<CategoryRow[]>`
    SELECT
      pm.category AS "category",
      COUNT(DISTINCT pm.product_id) AS "productCount",
      COUNT(DISTINCT vp.vendor_name) AS "vendorCount"
    FROM product_master pm
    LEFT JOIN vendor_prices vp ON vp.product_id = pm.product_id
    WHERE pm.category IS NOT NULL AND BTRIM(pm.category) <> ''
    GROUP BY pm.category
    ORDER BY pm.category ASC
  `;

  return rows.map((row) => ({
    category: row.category,
    productCount: Number(row.productCount),
    vendorCount: Number(row.vendorCount),
  }));
}

export async function getProductSheetGrid(category: string): Promise<ProductSheetGrid> {
  const sql = getSql();
  const rows = await sql<GridRow[]>`
    SELECT
      pm.product_id AS "productId",
      pm.product_name AS "productName",
      pm.product_maker AS "productMaker",
      pm.spec AS "spec",
      pm.category AS "category",
      pm.quality_flag AS "qualityFlag",
      pm.last_updated_at AS "lastUpdatedAt",
      vp.vendor_price_id AS "vendorPriceId",
      vp.vendor_name AS "vendorName",
      vp.unit_price AS "unitPrice",
      vp.price_updated_on AS "priceUpdatedOn",
      vp.updated_at AS "updatedAt"
    FROM product_master pm
    LEFT JOIN vendor_prices vp ON vp.product_id = pm.product_id
    WHERE pm.category = ${category}
    ORDER BY
      pm.product_name ASC,
      pm.spec ASC NULLS LAST,
      pm.product_maker ASC NULLS LAST,
      vp.vendor_name ASC
  `;

  const vendorNames = new Set<string>();
  const rowMap = new Map<string, ProductSheetRow>();

  for (const row of rows) {
    if (!rowMap.has(row.productId)) {
      rowMap.set(row.productId, {
        productId: row.productId,
        productName: row.productName,
        productMaker: row.productMaker,
        spec: row.spec,
        qualityFlag: row.qualityFlag,
        lastUpdatedAt: row.lastUpdatedAt,
        prices: {},
      });
    }

    if (row.vendorName && row.vendorPriceId && row.unitPrice != null) {
      vendorNames.add(row.vendorName);
      const productRow = rowMap.get(row.productId);
      if (productRow && !productRow.prices[row.vendorName]) {
        productRow.prices[row.vendorName] = {
          vendorPriceId: row.vendorPriceId,
          unitPrice: row.unitPrice,
          priceUpdatedOn: row.priceUpdatedOn,
          updatedAt: row.updatedAt,
        };
      }
    }
  }

  return {
    category,
    vendors: Array.from(vendorNames)
      .sort((a, b) => a.localeCompare(b, "ja"))
      .map((vendorName) => ({ vendorName })),
    rows: Array.from(rowMap.values()),
  };
}
