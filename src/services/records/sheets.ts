import "server-only";
import { z } from "zod";
import { getSql } from "@/db/client";

const dateRegex = /^\d{4}-\d{2}-\d{2}$/;
const maxChangedCells = 500;

export const productSheetCategoryParamSchema = z.object({
  category: z
    .string()
    .transform((value, ctx) => {
      try {
        return decodeURIComponent(value).trim();
      } catch {
        ctx.addIssue({ code: "custom", message: "Invalid category encoding" });
        return z.NEVER;
      }
    })
    .pipe(z.string().min(1).max(200)),
});

const updateProductSheetCellSchema = z
  .object({
    vendorPriceId: z.string().uuid(),
    unitPrice: z
      .union([z.number(), z.string()])
      .optional()
      .transform((value, ctx) => {
        if (value === undefined) return undefined;
        if (typeof value === "string" && value.trim() === "") {
          ctx.addIssue({ code: "custom", message: "unitPrice is required when present" });
          return z.NEVER;
        }
        const numeric = typeof value === "number" ? value : Number(value);
        if (!Number.isFinite(numeric) || numeric < 0 || numeric > 999999999) {
          ctx.addIssue({ code: "custom", message: "unitPrice must be between 0 and 999999999" });
          return z.NEVER;
        }
        return numeric;
      }),
    priceUpdatedOn: z
      .union([z.string().trim().regex(dateRegex), z.null()])
      .optional()
      .transform((value) => (value === "" ? null : value)),
  })
  .refine((cell) => cell.unitPrice !== undefined || cell.priceUpdatedOn !== undefined, {
    message: "At least one editable field is required",
  });

export const productSheetsSearchSchema = z.object({
  q: z.string().trim().max(200).optional(),
  productName: z.string().trim().max(200).optional(),
  vendor: z.string().trim().max(200).optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(50),
});

export const updateProductSheetCellsSchema = z
  .object({
    cells: z.array(updateProductSheetCellSchema).min(1).max(maxChangedCells),
  })
  .refine(
    (payload) =>
      new Set(payload.cells.map((cell) => cell.vendorPriceId)).size === payload.cells.length,
    {
      message: "Duplicate vendorPriceId is not allowed",
      path: ["cells"],
    },
  );

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

export type ProductSheetsSearchParams = z.infer<typeof productSheetsSearchSchema>;

export type ProductSheetsSearchState = ProductSheetsSearchParams & {
  total: number;
};

export type ProductSheetsSearchResult = {
  grid: ProductSheetGrid;
  search: ProductSheetsSearchState;
};

export type UpdateProductSheetCell = z.infer<typeof updateProductSheetCellSchema>;
export type UpdateProductSheetCellsInput = z.infer<typeof updateProductSheetCellsSchema>;

export class ProductSheetCellsNotFoundError extends Error {
  constructor() {
    super("Product sheet cells were not found in the requested category");
    this.name = "ProductSheetCellsNotFoundError";
  }
}

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

type ProductSheetsCountRow = {
  total: string | number;
};

type ProductSheetsProductRow = {
  productId: string;
};

type CurrentVendorPriceRow = {
  vendorPriceId: string;
  productId: string;
  vendorName: string;
  unitPrice: string | number;
  priceUpdatedOn: string | Date | null;
};

function toIsoDate(value: string | Date | null | undefined): string | null {
  if (!value) return null;
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (dateRegex.test(trimmed)) return trimmed;
    const parsed = new Date(trimmed);
    return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString().slice(0, 10);
  }
  return value.toISOString().slice(0, 10);
}

function normalizePrice(value: string | number): string {
  return Number(value).toFixed(2);
}

function escapeLike(input: string): string {
  return input.replace(/[\\%_]/g, (match) => `\\${match}`);
}

function likePattern(input: string): string {
  return `%${escapeLike(input)}%`;
}

function tokenizeFreeword(input: string): string[] {
  return input
    .trim()
    .split(/[\s\u3000]+/g)
    .map((token) => token.trim())
    .filter(Boolean)
    .slice(0, 8);
}

function buildProductSheetSearchWhere(
  sql: ReturnType<typeof getSql>,
  params: ProductSheetsSearchParams,
) {
  const conditions: ReturnType<typeof sql>[] = [];

  if (params.productName) {
    conditions.push(sql`pm.product_name ILIKE ${likePattern(params.productName)} ESCAPE '\\'`);
  }

  if (params.vendor) {
    conditions.push(sql`EXISTS (
      SELECT 1
      FROM vendor_prices vp_filter
      WHERE vp_filter.product_id = pm.product_id
        AND vp_filter.vendor_name ILIKE ${likePattern(params.vendor)} ESCAPE '\\'
    )`);
  }

  if (params.q) {
    for (const token of tokenizeFreeword(params.q)) {
      const pattern = likePattern(token);
      conditions.push(sql`(
        pm.product_name ILIKE ${pattern} ESCAPE '\\'
        OR COALESCE(pm.spec, '') ILIKE ${pattern} ESCAPE '\\'
        OR pm.product_key ILIKE ${pattern} ESCAPE '\\'
        OR EXISTS (
          SELECT 1
          FROM vendor_prices vp_q
          WHERE vp_q.product_id = pm.product_id
            AND vp_q.vendor_name ILIKE ${pattern} ESCAPE '\\'
        )
      )`);
    }
  }

  if (conditions.length === 0) return sql``;

  return conditions
    .slice(1)
    .reduce((where, condition) => sql`${where} AND ${condition}`, sql`WHERE ${conditions[0]}`);
}

function rowsToProductSheetGrid(category: string, rows: GridRow[]): ProductSheetGrid {
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

  return rowsToProductSheetGrid(category, rows);
}

export async function searchProductSheetGrid(
  params: ProductSheetsSearchParams,
): Promise<ProductSheetsSearchResult> {
  const sql = getSql();
  const where = buildProductSheetSearchWhere(sql, params);
  const limit = params.pageSize;
  const offset = (params.page - 1) * params.pageSize;

  const [countRows, productRows] = await Promise.all([
    sql<ProductSheetsCountRow[]>`
      SELECT COUNT(*) AS total
      FROM product_master pm
      ${where}
    `,
    sql<ProductSheetsProductRow[]>`
      SELECT pm.product_id AS "productId"
      FROM product_master pm
      ${where}
      ORDER BY
        pm.product_name ASC,
        pm.spec ASC NULLS LAST,
        pm.product_maker ASC NULLS LAST,
        pm.product_id ASC
      LIMIT ${limit}
      OFFSET ${offset}
    `,
  ]);

  const productIds = productRows.map((row) => row.productId);
  const rows = productIds.length
    ? await sql<GridRow[]>`
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
        WHERE pm.product_id = ANY(${productIds}::uuid[])
        ORDER BY
          pm.product_name ASC,
          pm.spec ASC NULLS LAST,
          pm.product_maker ASC NULLS LAST,
          vp.vendor_name ASC
      `
    : [];

  const total = Number(countRows[0]?.total ?? 0);

  return {
    grid: rowsToProductSheetGrid("仕切り表", rows),
    search: { ...params, total },
  };
}

export async function updateProductSheetCells(
  category: string,
  payload: UpdateProductSheetCellsInput,
): Promise<{ batchId: string; changedCount: number; grid: ProductSheetGrid }> {
  const sql = getSql();
  const batchId = crypto.randomUUID();
  const vendorPriceIds = payload.cells.map((cell) => cell.vendorPriceId);
  let changedCount = 0;

  await sql.begin(async (tx) => {
    const trx = tx as unknown as typeof sql;
    const currentRows = await trx<CurrentVendorPriceRow[]>`
      SELECT
        vp.vendor_price_id AS "vendorPriceId",
        vp.product_id AS "productId",
        vp.vendor_name AS "vendorName",
        vp.unit_price AS "unitPrice",
        vp.price_updated_on AS "priceUpdatedOn"
      FROM vendor_prices vp
      JOIN product_master pm ON pm.product_id = vp.product_id
      WHERE vp.vendor_price_id = ANY(${vendorPriceIds}::uuid[])
        AND pm.category = ${category}
      FOR UPDATE OF vp
    `;

    if (currentRows.length !== payload.cells.length) {
      throw new ProductSheetCellsNotFoundError();
    }

    const currentById = new Map(currentRows.map((row) => [row.vendorPriceId, row]));

    for (const cell of payload.cells) {
      const current = currentById.get(cell.vendorPriceId);
      if (!current) throw new ProductSheetCellsNotFoundError();

      const unitPriceChanged =
        cell.unitPrice !== undefined &&
        normalizePrice(current.unitPrice) !== normalizePrice(cell.unitPrice);
      const priceUpdatedOnBefore = toIsoDate(current.priceUpdatedOn);
      const priceUpdatedOnChanged =
        cell.priceUpdatedOn !== undefined && priceUpdatedOnBefore !== cell.priceUpdatedOn;

      if (!unitPriceChanged && !priceUpdatedOnChanged) continue;

      const nextUnitPrice =
        unitPriceChanged && cell.unitPrice !== undefined ? cell.unitPrice : current.unitPrice;
      const nextPriceUpdatedOn =
        priceUpdatedOnChanged && cell.priceUpdatedOn !== undefined
          ? cell.priceUpdatedOn
          : priceUpdatedOnBefore;

      await trx`
        UPDATE vendor_prices
        SET
          unit_price = ${nextUnitPrice},
          price_updated_on = ${nextPriceUpdatedOn},
          updated_at = now()
        WHERE vendor_price_id = ${cell.vendorPriceId}
      `;

      if (unitPriceChanged) {
        changedCount += 1;
        await trx`
          INSERT INTO update_history (
            update_key,
            product_id,
            field_name,
            vendor_name,
            before_value,
            after_value,
            source_type,
            source_id,
            updated_by
          )
          VALUES (
            ${`${batchId}:${cell.vendorPriceId}:unit_price`},
            ${current.productId},
            'vendor_price',
            ${current.vendorName},
            ${String(current.unitPrice)},
            ${String(nextUnitPrice)},
            'MANUAL_GRID',
            ${batchId},
            'unknown'
          )
        `;
      }

      if (priceUpdatedOnChanged) {
        changedCount += 1;
        await trx`
          INSERT INTO update_history (
            update_key,
            product_id,
            field_name,
            vendor_name,
            before_value,
            after_value,
            source_type,
            source_id,
            updated_by
          )
          VALUES (
            ${`${batchId}:${cell.vendorPriceId}:price_updated_on`},
            ${current.productId},
            'price_updated_on',
            ${current.vendorName},
            ${priceUpdatedOnBefore},
            ${nextPriceUpdatedOn},
            'MANUAL_GRID',
            ${batchId},
            'unknown'
          )
        `;
      }
    }
  });

  return {
    batchId,
    changedCount,
    grid: await getProductSheetGrid(category),
  };
}

export async function updateProductSheetCellsWithoutCategory(
  payload: UpdateProductSheetCellsInput,
): Promise<{ batchId: string; changedCount: number; grid: ProductSheetGrid }> {
  const sql = getSql();
  const batchId = crypto.randomUUID();
  const vendorPriceIds = payload.cells.map((cell) => cell.vendorPriceId);
  let changedCount = 0;

  await sql.begin(async (tx) => {
    const trx = tx as unknown as typeof sql;
    const currentRows = await trx<CurrentVendorPriceRow[]>`
      SELECT
        vp.vendor_price_id AS "vendorPriceId",
        vp.product_id AS "productId",
        vp.vendor_name AS "vendorName",
        vp.unit_price AS "unitPrice",
        vp.price_updated_on AS "priceUpdatedOn"
      FROM vendor_prices vp
      WHERE vp.vendor_price_id = ANY(${vendorPriceIds}::uuid[])
      FOR UPDATE OF vp
    `;

    if (currentRows.length !== payload.cells.length) {
      throw new ProductSheetCellsNotFoundError();
    }

    const currentById = new Map(currentRows.map((row) => [row.vendorPriceId, row]));

    for (const cell of payload.cells) {
      const current = currentById.get(cell.vendorPriceId);
      if (!current) throw new ProductSheetCellsNotFoundError();

      const unitPriceChanged =
        cell.unitPrice !== undefined &&
        normalizePrice(current.unitPrice) !== normalizePrice(cell.unitPrice);
      const priceUpdatedOnBefore = toIsoDate(current.priceUpdatedOn);
      const priceUpdatedOnChanged =
        cell.priceUpdatedOn !== undefined && priceUpdatedOnBefore !== cell.priceUpdatedOn;

      if (!unitPriceChanged && !priceUpdatedOnChanged) continue;

      const nextUnitPrice =
        unitPriceChanged && cell.unitPrice !== undefined ? cell.unitPrice : current.unitPrice;
      const nextPriceUpdatedOn =
        priceUpdatedOnChanged && cell.priceUpdatedOn !== undefined
          ? cell.priceUpdatedOn
          : priceUpdatedOnBefore;

      await trx`
        UPDATE vendor_prices
        SET
          unit_price = ${nextUnitPrice},
          price_updated_on = ${nextPriceUpdatedOn},
          updated_at = now()
        WHERE vendor_price_id = ${cell.vendorPriceId}
      `;

      if (unitPriceChanged) {
        changedCount += 1;
        await trx`
          INSERT INTO update_history (
            update_key,
            product_id,
            field_name,
            vendor_name,
            before_value,
            after_value,
            source_type,
            source_id,
            updated_by
          )
          VALUES (
            ${`${batchId}:${cell.vendorPriceId}:unit_price`},
            ${current.productId},
            'vendor_price',
            ${current.vendorName},
            ${String(current.unitPrice)},
            ${String(nextUnitPrice)},
            'MANUAL_GRID',
            ${batchId},
            'unknown'
          )
        `;
      }

      if (priceUpdatedOnChanged) {
        changedCount += 1;
        await trx`
          INSERT INTO update_history (
            update_key,
            product_id,
            field_name,
            vendor_name,
            before_value,
            after_value,
            source_type,
            source_id,
            updated_by
          )
          VALUES (
            ${`${batchId}:${cell.vendorPriceId}:price_updated_on`},
            ${current.productId},
            'price_updated_on',
            ${current.vendorName},
            ${priceUpdatedOnBefore},
            ${nextPriceUpdatedOn},
            'MANUAL_GRID',
            ${batchId},
            'unknown'
          )
        `;
      }
    }
  });

  return {
    batchId,
    changedCount,
    grid: (await searchProductSheetGrid(productSheetsSearchSchema.parse({}))).grid,
  };
}
