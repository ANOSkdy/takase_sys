import { NextResponse } from "next/server";
import { z } from "zod";
import { problemResponse } from "@/app/api/_utils/problem";
import { getProductDetail } from "@/services/products/repository";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const paramsSchema = z.object({
  productId: z.string().uuid(),
});

export async function GET(_req: Request, context: { params: Promise<{ productId: string }> }) {
  const parsedParams = paramsSchema.safeParse(await context.params);
  if (!parsedParams.success) {
    return problemResponse(400, "Bad Request", "Invalid productId", parsedParams.error.flatten());
  }

  try {
    const product = await getProductDetail(parsedParams.data.productId);
    if (!product) {
      return problemResponse(404, "Not Found", "Product not found");
    }
    return NextResponse.json(product);
  } catch (error) {
    console.error("[products] detail failed", error);
    return problemResponse(500, "Internal Server Error", "Failed to fetch product");
  }
}
