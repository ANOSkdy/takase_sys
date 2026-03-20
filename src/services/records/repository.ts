import "server-only";
import { z } from "zod";
import { getSql } from "@/db/client";
import { makeProductKey } from "@/domain/normalize";

const dateRegex = /^\d{4}-\d{2}-\d{2}$/;

export const recordIdSchema = z.object({
  recordId: z.string().uuid(),
});

export const updateRecordSchema = z.object({
  productName: z.string().trim().min(1).max(200),
  productMaker: z
    .string()
    .trim()
    .max(200)
    .nullable()
    .optional()
    .transform((v) => (v && v.length > 0 ? v : null)),
  spec: z
    .string()
    .trim()
    .max(200)
    .nullable()
    .optional()
    .transform((v) => (v && v.length > 0 ? v : null)),
  vendorName: z.string().trim().min(1).max(200),
  unitPrice: z.coerce.number().nonnegative().max(999999999),
  priceUpdatedOn: z
    .string()
    .trim()
    .regex(dateRegex)
    .nullable()
    .optional()
    .transform((v) => (v && v.length > 0 ? v : null)),
});

export const createRecordSchema = z.object({
  productName: z.string().trim().min(1).max(200),
  productMaker: z
    .string()
    .trim()
    .max(200)
    .nullable()
    .optional()
    .transform((v) => (v && v.length > 0 ? v : null)),
  spec: z
    .string()
    .trim()
    .max(200)
    .nullable()
    .optional()
    .transform((v) => (v && v.length > 0 ? v : null)),
  category: z
    .string()
    .trim()
    .max(200)
    .nullable()
    .optional()
    .transform((v) => (v && v.length > 0 ? v : null)),
  vendorName: z.string().trim().min(1).max(200),
  unitPrice: z.coerce.number().nonnegative().max(999999999),
  priceUpdatedOn: z
    .string()
    .trim()
    .regex(dateRegex)
    .nullable()
    .optional()
    .transform((v) => (v && v.length > 0 ? v : null)),
});

export type EditableRecord = {
  recordId: string;
  productId: string;
  productName: string;
  spec: string | null;
  productMaker: string | null;
  category: string | null;
  vendorName: string;
  unitPrice: number;
  priceUpdatedOn: string | null;
  lastUpdatedOn: string | null;
};

function toIsoDate(value: string | Date | null | undefined): string | null {
  if (!value) return null;
  if (typeof value === "string") {
    const trimmed = value.trim();
    return /^\d{4}-\d{2}-\d{2}$/.test(trimmed) ? trimmed : null;
  }
  return value.toISOString().slice(0, 10);
}

function toRecord(row: {
  recordId: string;
  productId: string;
  productName: string;
  spec: string | null;
  productMaker: string | null;
  category: string | null;
  vendorName: string;
  unitPrice: string | number;
  priceUpdatedOn: string | Date | null;
  lastUpdatedOn: string | Date | null;
}): EditableRecord {
  return {
    recordId: row.recordId,
    productId: row.productId,
    productName: row.productName,
    spec: row.spec,
    productMaker: row.productMaker,
    category: row.category,
    vendorName: row.vendorName,
    unitPrice: Number(row.unitPrice),
    priceUpdatedOn: toIsoDate(row.priceUpdatedOn),
    lastUpdatedOn: toIsoDate(row.lastUpdatedOn),
  };
}

export async function getRecordById(recordId: string): Promise<EditableRecord | null> {
  const sql = getSql();
  const rows = await sql<
    {
      recordId: string;
      productId: string;
      productName: string;
      spec: string | null;
      productMaker: string | null;
      category: string | null;
      vendorName: string;
      unitPrice: string | number;
      priceUpdatedOn: string | Date | null;
      lastUpdatedOn: string | Date | null;
    }[]
  >`
    SELECT
      vp.vendor_price_id AS "recordId",
      pm.product_id AS "productId",
      pm.product_name AS "productName",
      pm.spec AS "spec",
      pm.product_maker AS "productMaker",
      pm.category AS "category",
      vp.vendor_name AS "vendorName",
      vp.unit_price AS "unitPrice",
      vp.price_updated_on AS "priceUpdatedOn",
      COALESCE(vp.price_updated_on, vp.updated_at::date) AS "lastUpdatedOn"
    FROM vendor_prices vp
    JOIN product_master pm ON pm.product_id = vp.product_id
    WHERE vp.vendor_price_id = ${recordId}
    LIMIT 1
  `;

  if (rows.length === 0) return null;
  return toRecord(rows[0]);
}

export async function updateRecordById(
  recordId: string,
  payload: z.infer<typeof updateRecordSchema>,
): Promise<EditableRecord | null> {
  const sql = getSql();

  const current = await sql<{ productId: string }[]>`
    SELECT product_id AS "productId"
    FROM vendor_prices
    WHERE vendor_price_id = ${recordId}
    LIMIT 1
  `;
  if (current.length === 0) return null;

  const { productId } = current[0];

  await sql`
    UPDATE product_master
    SET
      product_name = ${payload.productName},
      product_maker = ${payload.productMaker ?? null},
      spec = ${payload.spec ?? null},
      last_updated_at = now()
    WHERE product_id = ${productId}
  `;

  await sql`
    UPDATE vendor_prices
    SET
      vendor_name = ${payload.vendorName},
      unit_price = ${payload.unitPrice},
      price_updated_on = ${payload.priceUpdatedOn ?? null},
      updated_at = now()
    WHERE vendor_price_id = ${recordId}
  `;

  const rows = await sql<
    {
      recordId: string;
      productId: string;
      productName: string;
      spec: string | null;
      productMaker: string | null;
      category: string | null;
      vendorName: string;
      unitPrice: string | number;
      priceUpdatedOn: string | Date | null;
      lastUpdatedOn: string | Date | null;
    }[]
  >`
    SELECT
      vp.vendor_price_id AS "recordId",
      pm.product_id AS "productId",
      pm.product_name AS "productName",
      pm.spec AS "spec",
      pm.product_maker AS "productMaker",
      pm.category AS "category",
      vp.vendor_name AS "vendorName",
      vp.unit_price AS "unitPrice",
      vp.price_updated_on AS "priceUpdatedOn",
      COALESCE(vp.price_updated_on, vp.updated_at::date) AS "lastUpdatedOn"
    FROM vendor_prices vp
    JOIN product_master pm ON pm.product_id = vp.product_id
    WHERE vp.vendor_price_id = ${recordId}
    LIMIT 1
  `;

  return rows.length ? toRecord(rows[0]) : null;
}

export async function createRecord(
  payload: z.infer<typeof createRecordSchema>,
): Promise<EditableRecord> {
  const sql = getSql();
  const productKey = makeProductKey(payload.productName, payload.spec, payload.productMaker);
  const productId = crypto.randomUUID();
  const recordId = crypto.randomUUID();

  await sql`
    INSERT INTO product_master (
      product_id,
      product_key,
      product_name,
      product_maker,
      spec,
      category,
      quality_flag,
      last_updated_at
    )
    VALUES (
      ${productId},
      ${productKey},
      ${payload.productName},
      ${payload.productMaker ?? null},
      ${payload.spec ?? null},
      ${payload.category ?? null},
      'OK',
      now()
    )
  `;

  await sql`
    INSERT INTO vendor_prices (
      vendor_price_id,
      product_id,
      vendor_name,
      unit_price,
      price_updated_on,
      source_type,
      source_id,
      updated_at
    )
    VALUES (
      ${recordId},
      ${productId},
      ${payload.vendorName},
      ${payload.unitPrice},
      ${payload.priceUpdatedOn ?? null},
      'MANUAL',
      ${recordId},
      now()
    )
  `;

  const rows = await sql<
    {
      recordId: string;
      productId: string;
      productName: string;
      spec: string | null;
      productMaker: string | null;
      category: string | null;
      vendorName: string;
      unitPrice: string | number;
      priceUpdatedOn: string | Date | null;
      lastUpdatedOn: string | Date | null;
    }[]
  >`
    SELECT
      vp.vendor_price_id AS "recordId",
      pm.product_id AS "productId",
      pm.product_name AS "productName",
      pm.spec AS "spec",
      pm.product_maker AS "productMaker",
      pm.category AS "category",
      vp.vendor_name AS "vendorName",
      vp.unit_price AS "unitPrice",
      vp.price_updated_on AS "priceUpdatedOn",
      COALESCE(vp.price_updated_on, vp.updated_at::date) AS "lastUpdatedOn"
    FROM vendor_prices vp
    JOIN product_master pm ON pm.product_id = vp.product_id
    WHERE vp.vendor_price_id = ${recordId}
    LIMIT 1
  `;

  return toRecord(rows[0]);
}
