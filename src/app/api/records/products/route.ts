import { NextResponse } from "next/server";
import {
  ProductAlreadyExistsError,
  createRecordProduct,
  createRecordProductSchema,
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

export async function POST(req: Request) {
  const rawBody = await req.json().catch(() => null);
  const parsedBody = createRecordProductSchema.safeParse(rawBody);
  if (!parsedBody.success) {
    return errorResponse(
      400,
      "VALIDATION_ERROR",
      "リクエスト内容が正しくありません。",
      parsedBody.error.flatten(),
    );
  }

  try {
    const created = await createRecordProduct(parsedBody.data);
    return NextResponse.json(created, { status: 201, headers: noStoreHeaders });
  } catch (error) {
    if (error instanceof ProductAlreadyExistsError) {
      return errorResponse(
        409,
        "PRODUCT_ALREADY_EXISTS",
        "同じ品名・規格の商品が既に存在します。",
        {
          productKey: error.productKey,
        },
      );
    }

    console.error("[records:products] product creation failed", error);
    return errorResponse(500, "INTERNAL_SERVER_ERROR", "商品の追加に失敗しました。");
  }
}
