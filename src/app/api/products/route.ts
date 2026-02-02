import { NextResponse } from "next/server";
import { problemResponse } from "@/app/api/_utils/problem";
import { productSearchSchema, searchProducts } from "@/services/products/search";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  try {
    const url = new URL(req.url);
    const parsed = productSearchSchema.safeParse({
      keyword: url.searchParams.get("keyword") ?? undefined,
      category: url.searchParams.get("category") ?? undefined,
      vendor: url.searchParams.get("vendor") ?? undefined,
      quality_flag: url.searchParams.get("quality_flag") ?? undefined,
      page: url.searchParams.get("page") ?? undefined,
      pageSize: url.searchParams.get("pageSize") ?? undefined,
    });

    if (!parsed.success) {
      return problemResponse(400, "Bad Request", "Invalid query", parsed.error.flatten());
    }

    const result = await searchProducts(parsed.data);
    return NextResponse.json(result);
  } catch (error) {
    console.error("[products] list failed", error);
    return problemResponse(500, "Internal Server Error", "Failed to fetch products");
  }
}
