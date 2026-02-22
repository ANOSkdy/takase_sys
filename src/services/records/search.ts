import "server-only";
import { z } from "zod";
import { Pool } from "pg";

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  max: 5,
});

const dateRegex = /^\d{4}-\d{2}-\d{2}$/;

export const recordSearchSchema = z
  .object({
    q: z.string().trim().max(200).optional(),
    name: z.string().trim().max(200).optional(),
    spec: z.string().trim().max(200).optional(),
    vendor: z.string().trim().max(200).optional(),
    category: z.string().trim().max(200).optional(),

    priceMin: z.coerce.number().nonnegative().optional(),
    priceMax: z.coerce.number().nonnegative().optional(),

    updatedFrom: z.string().regex(dateRegex).optional(),
    updatedTo: z.string().regex(dateRegex).optional(),

    page: z.coerce.number().int().min(1).default(1),
    pageSize: z.coerce.number().int().min(1).max(200).default(50),
  })
  .superRefine((v, ctx) => {
    if (v.priceMin != null && v.priceMax != null && v.priceMin > v.priceMax) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "priceMin must be <= priceMax",
        path: ["priceMin"],
      });
    }
    if (v.updatedFrom && v.updatedTo && v.updatedFrom > v.updatedTo) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "updatedFrom must be <= updatedTo",
        path: ["updatedFrom"],
      });
    }
  });

export type RecordSearchParams = z.infer<typeof recordSearchSchema>;

export type RecordRow = {
  recordId: string;
  productId: string;
  productName: string;
  spec: string | null;
  category: string | null;
  vendorName: string;
  unitPrice: number;
  priceUpdatedOn: string | null;
  lastUpdatedOn: string | null; // YYYY-MM-DD
};

export type RecordSearchResult = {
  items: RecordRow[];
  categories: string[];
  total: number;
  page: number;
  pageSize: number;
};

type SqlParam = string | number | boolean | null;

type DbRow = {
  recordId: string;
  productId: string;
  productName: string;
  spec: string | null;
  category: string | null;
  vendorName: string;
  unitPrice: string | number;
  priceUpdatedOn: string | Date | null;
  lastUpdatedOn: string | Date | null;
  totalCount: string | number;
};

function toIsoDate(value: string | Date | null | undefined): string | null {
  if (!value) return null;
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) {
      return trimmed;
    }
    return null;
  }
  return value.toISOString().slice(0, 10);
}

function escapeLike(input: string): string {
  return input.replace(/[\\%_]/g, (m) => `\\${m}`);
}
function likePattern(input: string): string {
  return `%${escapeLike(input)}%`;
}
function tokenizeFreeword(q: string): string[] {
  return q
    .trim()
    .split(/[\s\u3000]+/g)
    .map((s) => s.trim())
    .filter(Boolean)
    .slice(0, 8);
}

export async function searchRecords(params: RecordSearchParams): Promise<RecordSearchResult> {
  const where: string[] = [];
  const values: SqlParam[] = [];

  const add = (sqlFragmentWithDollar: string, value: SqlParam) => {
    values.push(value);
    const ph = `$${values.length}`;
    where.push(sqlFragmentWithDollar.replace("$$", ph));
  };

  if (params.name) add(`pm.product_name ILIKE $$ ESCAPE '\\'`, likePattern(params.name));
  if (params.spec) add(`COALESCE(pm.spec,'') ILIKE $$ ESCAPE '\\'`, likePattern(params.spec));
  if (params.vendor) add(`vp.vendor_name ILIKE $$ ESCAPE '\\'`, likePattern(params.vendor));
  if (params.category)
    add(`COALESCE(pm.category,'') ILIKE $$ ESCAPE '\\'`, likePattern(params.category));

  if (params.priceMin != null) add(`vp.unit_price >= $$`, params.priceMin);
  if (params.priceMax != null) add(`vp.unit_price <= $$`, params.priceMax);

  if (params.updatedFrom) {
    add(`COALESCE(vp.price_updated_on, vp.updated_at::date) >= $$::date`, params.updatedFrom);
  }
  if (params.updatedTo) {
    add(`COALESCE(vp.price_updated_on, vp.updated_at::date) <= $$::date`, params.updatedTo);
  }

  if (params.q) {
    const tokens = tokenizeFreeword(params.q);
    for (const t of tokens) {
      values.push(likePattern(t));
      const ph = `$${values.length}`;
      where.push(
        `(
          pm.product_name ILIKE ${ph} ESCAPE '\\'
          OR COALESCE(pm.spec,'') ILIKE ${ph} ESCAPE '\\'
          OR vp.vendor_name ILIKE ${ph} ESCAPE '\\'
          OR COALESCE(pm.category,'') ILIKE ${ph} ESCAPE '\\'
        )`,
      );
    }
  }

  const whereSql = where.length ? `WHERE ${where.join(" AND ")}` : "";

  const limit = params.pageSize;
  const offset = (params.page - 1) * params.pageSize;

  values.push(limit);
  const limitPh = `$${values.length}`;
  values.push(offset);
  const offsetPh = `$${values.length}`;

  const sql = `
    SELECT
      vp.vendor_price_id AS "recordId",
      pm.product_id AS "productId",
      pm.product_name AS "productName",
      pm.spec AS "spec",
      pm.category AS "category",
      vp.vendor_name AS "vendorName",
      vp.unit_price AS "unitPrice",
      vp.price_updated_on AS "priceUpdatedOn",
      COALESCE(vp.price_updated_on, vp.updated_at::date) AS "lastUpdatedOn",
      COUNT(*) OVER() AS "totalCount"
    FROM vendor_prices vp
    JOIN product_master pm
      ON pm.product_id = vp.product_id
    ${whereSql}
    ORDER BY
      COALESCE(vp.price_updated_on, vp.updated_at::date) DESC NULLS LAST,
      pm.product_name ASC
    LIMIT ${limitPh}
    OFFSET ${offsetPh}
  `;

  const [{ rows }, categoryResult] = await Promise.all([
    pool.query<DbRow>(sql, values),
    pool.query<{ category: string | null }>(`
      SELECT DISTINCT pm.category AS category
      FROM product_master pm
      WHERE pm.category IS NOT NULL AND pm.category <> ''
      ORDER BY pm.category ASC
    `),
  ]);

  const total = rows.length ? Number(rows[0].totalCount) : 0;
  const categories = categoryResult.rows.map((r) => r.category?.trim() ?? "").filter(Boolean);

  const items: RecordRow[] = rows.map((r) => ({
    recordId: r.recordId,
    productId: r.productId,
    productName: r.productName,
    spec: r.spec ?? null,
    category: r.category ?? null,
    vendorName: r.vendorName,
    unitPrice: Number(r.unitPrice),
    priceUpdatedOn: toIsoDate(r.priceUpdatedOn),
    lastUpdatedOn: toIsoDate(r.lastUpdatedOn),
  }));

  return { items, categories, total, page: params.page, pageSize: params.pageSize };
}
