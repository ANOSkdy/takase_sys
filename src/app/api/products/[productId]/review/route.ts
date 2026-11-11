import { NextResponse } from "next/server";
import { z } from "zod";
import { problemResponse } from "@/app/api/_utils/problem";
import { getDb } from "@/db/client";
import {
  applyReviewAction,
  reviewActionSchema,
  type ReviewFailureCode,
} from "@/services/products/review";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const paramsSchema = z.object({
  productId: z.string().uuid(),
});

const failureStatus: Record<ReviewFailureCode, number> = {
  NOT_FOUND: 404,
  STALE: 409,
  INVALID_STATE: 409,
  KEY_CONFLICT: 409,
  PRICE_CHOICE_REQUIRED: 409,
  INVALID_TARGET: 422,
  NO_CHANGE: 422,
};

/**
 * 商品の確認操作（確定・再確認依頼・修正・統合）。変更は POST のみで行う。
 * アプリ内認証はないため、アクセス制御はアプリ外の保護に依存する。
 */
export async function POST(req: Request, context: { params: Promise<{ productId: string }> }) {
  const parsedParams = paramsSchema.safeParse(await context.params);
  if (!parsedParams.success) {
    return problemResponse(400, "Bad Request", "Invalid productId");
  }

  const body = await req.json().catch(() => null);
  const parsedBody = reviewActionSchema.safeParse(body);
  if (!parsedBody.success) {
    const firstMessage = parsedBody.error.issues[0]?.message ?? "入力内容を確認してください。";
    return problemResponse(400, "Bad Request", firstMessage, parsedBody.error.flatten());
  }

  try {
    const result = await applyReviewAction(getDb(), parsedParams.data.productId, parsedBody.data);
    if (!result.ok) {
      return problemResponse(failureStatus[result.code], "Review Rejected", result.message, {
        code: result.code,
        conflictingProductId: result.conflictingProductId ?? null,
        priceConflicts: result.priceConflicts ?? [],
      });
    }
    return NextResponse.json(result, { headers: { "cache-control": "no-store" } });
  } catch (error) {
    console.error("[products] review action failed", {
      productId: parsedParams.data.productId,
      action: parsedBody.data.action,
      message: error instanceof Error ? error.message : String(error),
    });
    return problemResponse(500, "Internal Server Error", "確認操作を保存できませんでした。");
  }
}
