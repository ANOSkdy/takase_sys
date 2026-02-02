import "server-only";
import { z } from "zod";
import { Pool } from "pg";

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  max: 5,
});

export const productSearchSchema = z.object({
  keyword: z.string().trim().max(200).optional(),
  category: z.string().trim().max(200).optional(),
  vendor: z.string().trim().max(200).optional(),
  quality_flag: z.string().trim().max(200).optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(200).default(50),
});

export type ProductSearchParams = z.infer<typeof productSearchSchema>;

export type ProductListItem = {
  productId: string;
  productName: string;
  spec: string | null;
  category: string | null;
  qualityFlag: string;
  vendorCount: number;
  lastUpdatedOn: string | null;
};

export type ProductSearchResult = {
  items: ProductListItem[];
  total: number;
  page: number;
  pageSize: number;
};

type SqlParam = string | number | boolean | null;

type DbRow = {
  productId: string;
  productName: string;
  spec: string | null;
  category: string | null;
  qualityFlag: string;
  vendorCount: string | number;
  lastUpdatedOn: string | Date | null;
  totalCount: string | number;
};

function escapeLike(input: string): string {
  return input.replace(/[\\%_]/g, (m) => `\\${m}`);
}
function likePattern(input: string): string {
  return `%${escapeLike(input)}%`;
}

export async function searchProducts(params: ProductSearchParams): Promise<ProductSearchResult> {
  const where: string[] = [];
  const values: SqlParam[] = [];

  const add = (sqlFragmentWithDollar: string, value: SqlParam) => {
    values.push(value);
    const ph = `$${values.length}`;
    where.push(sqlFragmentWithDollar.replace("$$", ph));
  };

  if (params.keyword) {
    const pattern = likePattern(params.keyword);
    add(
      `(pm.product_name ILIKE $$ ESCAPE '\\' OR COALESCE(pm.spec,'') ILIKE $$ ESCAPE '\\')`,
      pattern,
    );
  }
  if (params.category) add(`COALESCE(pm.category,'') ILIKE $$ ESCAPE '\\'`, likePattern(params.category));
  if (params.quality_flag)
    add(`pm.quality_flag ILIKE $$ ESCAPE '\\'`, likePattern(params.quality_flag));
  if (params.vendor) {
    add(
      `EXISTS (
        SELECT 1 FROM vendor_prices vp2
        WHERE vp2.product_id = pm.product_id
          AND vp2.vendor_name ILIKE $$ ESCAPE '\\'
      )`,
      likePattern(params.vendor),
    );
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
      pm.product_id AS "productId",
      pm.product_name AS "productName",
      pm.spec AS "spec",
      pm.category AS "category",
      pm.quality_flag AS "qualityFlag",
      COUNT(vp.vendor_price_id) AS "vendorCount",
      MAX(COALESCE(vp.price_updated_on, vp.updated_at::date)) AS "lastUpdatedOn",
      COUNT(*) OVER() AS "totalCount"
    FROM product_master pm
    LEFT JOIN vendor_prices vp
      ON vp.product_id = pm.product_id
    ${whereSql}
    GROUP BY pm.product_id
    ORDER BY pm.product_name ASC
    LIMIT ${limitPh}
    OFFSET ${offsetPh}
  `;

  const { rows } = await pool.query<DbRow>(sql, values);

  const total = rows.length ? Number(rows[0].totalCount) : 0;
  const items: ProductListItem[] = rows.map((r) => ({
    productId: r.productId,
    productName: r.productName,
    spec: r.spec ?? null,
    category: r.category ?? null,
    qualityFlag: r.qualityFlag,
    vendorCount: Number(r.vendorCount),
    lastUpdatedOn: r.lastUpdatedOn ? String(r.lastUpdatedOn).slice(0, 10) : null,
  }));

  return { items, total, page: params.page, pageSize: params.pageSize };
}
