import { NextResponse } from "next/server";
import {
  listRecentVendorPriceHistory,
  productIdParamSchema,
  vendorPriceHistoryQuerySchema,
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

export async function GET(req: Request, context: { params: Promise<{ productId: string }> }) {
  const parsedParams = productIdParamSchema.safeParse(await context.params);
  if (!parsedParams.success) {
    return errorResponse(
      400,
      "VALIDATION_ERROR",
      "productId が正しくありません。",
      parsedParams.error.flatten(),
    );
  }

  const { searchParams } = new URL(req.url);
  const parsedQuery = vendorPriceHistoryQuerySchema.safeParse({
    vendorName: searchParams.get("vendorName") ?? "",
  });
  if (!parsedQuery.success) {
    return errorResponse(
      400,
      "VALIDATION_ERROR",
      "vendorName が正しくありません。",
      parsedQuery.error.flatten(),
    );
  }

  try {
    const items = await listRecentVendorPriceHistory(parsedParams.data.productId, parsedQuery.data);
    return NextResponse.json({ items }, { headers: noStoreHeaders });
  } catch (error) {
    console.error("[records:products] vendor price history fetch failed", error);
    return errorResponse(500, "INTERNAL_SERVER_ERROR", "変更履歴の取得に失敗しました。");
  }
}
