import "server-only";
import { z } from "zod";
import { getSql } from "@/db/client";
import { makeProductKey } from "@/domain/normalize";

const dateRegex = /^\d{4}-\d{2}-\d{2}$/;
const manualCreateSourceType = "MANUAL_CREATE";

function trimRequiredString(max: number, fieldName: string) {
  return z.string().transform((value, ctx) => {
    const trimmed = value.trim();
    if (trimmed.length < 1) {
      ctx.addIssue({ code: "custom", message: `${fieldName} is required` });
      return z.NEVER;
    }
    if (trimmed.length > max) {
      ctx.addIssue({ code: "custom", message: `${fieldName} must be at most ${max} characters` });
      return z.NEVER;
    }
    return trimmed;
  });
}

function trimOptionalString(max: number, fieldName: string) {
  return z
    .union([z.string(), z.null()])
    .optional()
    .transform((value, ctx) => {
      if (value == null) return null;
      const trimmed = value.trim();
      if (trimmed.length === 0) return null;
      if (trimmed.length > max) {
        ctx.addIssue({ code: "custom", message: `${fieldName} must be at most ${max} characters` });
        return z.NEVER;
      }
      return trimmed;
    });
}

const priceUpdatedOnSchema = z
  .union([z.string(), z.null()])
  .optional()
  .transform((value, ctx) => {
    if (value == null) return null;
    const trimmed = value.trim();
    if (trimmed.length === 0) return null;
    if (!dateRegex.test(trimmed)) {
      ctx.addIssue({ code: "custom", message: "priceUpdatedOn must be YYYY-MM-DD" });
      return z.NEVER;
    }
    return trimmed;
  });

const unitPriceSchema = z.union([z.number(), z.string()]).transform((value, ctx) => {
  if (typeof value === "string" && value.trim() === "") {
    ctx.addIssue({ code: "custom", message: "unitPrice is required" });
    return z.NEVER;
  }

  const numeric = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(numeric) || numeric < 0 || numeric > 999999999) {
    ctx.addIssue({ code: "custom", message: "unitPrice must be between 0 and 999999999" });
    return z.NEVER;
  }
  return numeric;
});

export const createRecordProductSchema = z.object({
  category: trimRequiredString(200, "category"),
  productName: trimRequiredString(300, "productName"),
  productMaker: trimOptionalString(200, "productMaker"),
  spec: trimOptionalString(300, "spec"),
  vendorPrice: z
    .object({
      vendorName: trimRequiredString(200, "vendorName"),
      unitPrice: unitPriceSchema,
      priceUpdatedOn: priceUpdatedOnSchema,
    })
    .optional(),
});

export const addVendorPriceToProductSchema = z.object({
  vendorName: trimRequiredString(200, "vendorName"),
  unitPrice: unitPriceSchema,
  priceUpdatedOn: priceUpdatedOnSchema,
});

export const productIdParamSchema = z.object({
  productId: z.string().uuid(),
});

export type CreateRecordProductInput = z.infer<typeof createRecordProductSchema>;
export type AddVendorPriceToProductInput = z.infer<typeof addVendorPriceToProductSchema>;

export type CreateRecordProductResult = {
  productId: string;
  productKey: string;
  category: string;
  created: true;
  vendorPriceId: string | null;
};

export type AddVendorPriceToProductResult = {
  productId: string;
  vendorPriceId: string;
  created: true;
};

export class ProductAlreadyExistsError extends Error {
  constructor(readonly productKey: string) {
    super("Product already exists");
    this.name = "ProductAlreadyExistsError";
  }
}

export class ProductNotFoundError extends Error {
  constructor(readonly productId: string) {
    super("Product not found");
    this.name = "ProductNotFoundError";
  }
}

export class VendorPriceAlreadyExistsError extends Error {
  constructor(readonly vendorPriceId: string | null) {
    super("Vendor price already exists");
    this.name = "VendorPriceAlreadyExistsError";
  }
}

type ProductInsertRow = {
  productId: string;
  productKey: string;
  category: string;
};

type VendorPriceInsertRow = {
  vendorPriceId: string;
};

async function insertVendorPriceWithHistory(
  tx: ReturnType<typeof getSql>,
  productId: string,
  input: AddVendorPriceToProductInput,
  batchId: string,
): Promise<string> {
  const vendorPriceId = crypto.randomUUID();
  const insertedVendorPrices = await tx<VendorPriceInsertRow[]>`
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
      ${vendorPriceId},
      ${productId},
      ${input.vendorName},
      ${input.unitPrice},
      ${input.priceUpdatedOn},
      ${manualCreateSourceType},
      ${batchId},
      now()
    )
    ON CONFLICT (product_id, vendor_name) DO NOTHING
    RETURNING vendor_price_id AS "vendorPriceId"
  `;

  if (insertedVendorPrices.length === 0) {
    const existing = await tx<VendorPriceInsertRow[]>`
      SELECT vendor_price_id AS "vendorPriceId"
      FROM vendor_prices
      WHERE product_id = ${productId}
        AND vendor_name = ${input.vendorName}
      LIMIT 1
    `;
    throw new VendorPriceAlreadyExistsError(existing[0]?.vendorPriceId ?? null);
  }

  await tx`
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
      ${`${batchId}:${productId}:vendor_price:${input.vendorName}`},
      ${productId},
      'vendor_price',
      ${input.vendorName},
      ${null},
      ${String(input.unitPrice)},
      ${manualCreateSourceType},
      ${batchId},
      'unknown'
    )
  `;

  return insertedVendorPrices[0].vendorPriceId;
}

export async function createRecordProduct(
  input: CreateRecordProductInput,
): Promise<CreateRecordProductResult> {
  const sql = getSql();
  const batchId = crypto.randomUUID();
  const productId = crypto.randomUUID();
  const productKey = makeProductKey(input.productName, input.spec);

  return await sql.begin(async (tx) => {
    const trx = tx as unknown as typeof sql;
    const insertedProducts = await trx<ProductInsertRow[]>`
      INSERT INTO product_master (
        product_id,
        product_key,
        product_name,
        product_maker,
        spec,
        category,
        quality_flag,
        last_updated_at,
        last_source_type,
        last_source_id
      )
      VALUES (
        ${productId},
        ${productKey},
        ${input.productName},
        ${input.productMaker},
        ${input.spec},
        ${input.category},
        'OK',
        now(),
        ${manualCreateSourceType},
        ${batchId}
      )
      ON CONFLICT (product_key) DO NOTHING
      RETURNING
        product_id AS "productId",
        product_key AS "productKey",
        category AS "category"
    `;

    if (insertedProducts.length === 0) {
      throw new ProductAlreadyExistsError(productKey);
    }

    const createdProduct = insertedProducts[0];
    const vendorPriceId = input.vendorPrice
      ? await insertVendorPriceWithHistory(
          trx,
          createdProduct.productId,
          input.vendorPrice,
          batchId,
        )
      : null;

    return {
      productId: createdProduct.productId,
      productKey: createdProduct.productKey,
      category: createdProduct.category,
      created: true,
      vendorPriceId,
    };
  });
}

export async function addVendorPriceToProduct(
  productId: string,
  input: AddVendorPriceToProductInput,
): Promise<AddVendorPriceToProductResult> {
  const sql = getSql();
  const batchId = crypto.randomUUID();
  let vendorPriceId: string | null = null;

  await sql.begin(async (tx) => {
    const trx = tx as unknown as typeof sql;
    const products = await trx<{ productId: string }[]>`
      SELECT product_id AS "productId"
      FROM product_master
      WHERE product_id = ${productId}
      FOR UPDATE
    `;

    if (products.length === 0) {
      throw new ProductNotFoundError(productId);
    }

    vendorPriceId = await insertVendorPriceWithHistory(trx, productId, input, batchId);
  });

  if (!vendorPriceId) {
    throw new Error("Vendor price creation failed");
  }

  return {
    productId,
    vendorPriceId,
    created: true,
  };
}
