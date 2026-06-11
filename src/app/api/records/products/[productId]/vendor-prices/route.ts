import { NextResponse } from "next/server";
import {
  ProductNotFoundError,
  VendorPriceAlreadyExistsError,
  addVendorPriceToProduct,
  addVendorPriceToProductSchema,
  productIdParamSchema,
} from "@/services/records/products";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

const noStoreHeaders = {
  "Cache-Control": "no-store, max-age=0",
  "Content-Type": "application/json; charset=utf-8",
};

function errorResponse(status: number, code: string, message: string, details?: unknown) {
  return NextResponse.json(
    { error: { code, message, ...(details ? { details } : {}) } },
    { status, headers: noStoreHeaders },
  );
}

export async function POST(req: Request, context: { params: Promise<{ productId: string }> }) {
  const parsedParams = productIdParamSchema.safeParse(await context.params);
  if (!parsedParams.success) {
    return errorResponse(
      400,
      "VALIDATION_ERROR",
      "productId が正しくありません。",
      parsedParams.error.flatten(),
    );
  }

  const rawBody = await req.json().catch(() => null);
  const parsedBody = addVendorPriceToProductSchema.safeParse(rawBody);
  if (!parsedBody.success) {
    return errorResponse(
      400,
      "VALIDATION_ERROR",
      "リクエスト内容が正しくありません。",
      parsedBody.error.flatten(),
    );
  }

  try {
    const created = await addVendorPriceToProduct(parsedParams.data.productId, parsedBody.data);
    return NextResponse.json(created, { status: 201, headers: noStoreHeaders });
  } catch (error) {
    if (error instanceof ProductNotFoundError) {
      return errorResponse(404, "PRODUCT_NOT_FOUND", "指定された商品が見つかりません。");
    }

    if (error instanceof VendorPriceAlreadyExistsError) {
      return errorResponse(
        409,
        "VENDOR_PRICE_ALREADY_EXISTS",
        "同じ商品・業者の価格が既に存在します。",
        { vendorPriceId: error.vendorPriceId },
      );
    }

    console.error("[records:products] vendor price creation failed", error);
    return errorResponse(500, "INTERNAL_SERVER_ERROR", "業者価格の追加に失敗しました。");
  }
}
