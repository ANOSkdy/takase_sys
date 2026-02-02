import { NextResponse } from "next/server";
import { z } from "zod";
import { problemResponse } from "@/app/api/_utils/problem";
import { getProductDetail } from "@/services/products/detail";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const paramsSchema = z.object({
  productId: z.string().uuid(),
});

export async function GET(
  _req: Request,
  context: { params: Promise<{ productId: string }> },
) {
  const parsed = paramsSchema.safeParse(await context.params);
  if (!parsed.success) {
    return problemResponse(400, "Bad Request", "Invalid productId", parsed.error.flatten());
  }

  try {
    const detail = await getProductDetail(parsed.data.productId);
    if (!detail) {
      return problemResponse(404, "Not Found", "Product not found");
    }
    return NextResponse.json(detail);
  } catch (error) {
    console.error("[products] detail failed", error);
    return problemResponse(500, "Internal Server Error", "Failed to fetch product");
  }
}
