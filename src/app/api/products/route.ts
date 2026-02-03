import { NextResponse } from "next/server";
import { z } from "zod";
import { problemResponse } from "@/app/api/_utils/problem";
import { listProducts } from "@/services/products/repository";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const querySchema = z.object({
  keyword: z.string().trim().min(1).max(200).optional(),
  category: z.string().trim().min(1).max(200).optional(),
  vendor: z.string().trim().min(1).max(200).optional(),
  qualityFlag: z.string().trim().min(1).max(50).optional(),
  page: z.coerce.number().int().min(1).optional(),
  pageSize: z.coerce.number().int().min(1).max(200).optional(),
});

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const parsed = querySchema.safeParse(Object.fromEntries(searchParams.entries()));
  if (!parsed.success) {
    return problemResponse(400, "Bad Request", "Invalid query params", parsed.error.flatten());
  }

  try {
    const result = await listProducts(parsed.data);
    return NextResponse.json(result);
  } catch (error) {
    console.error("[products] list failed", error);
    return problemResponse(500, "Internal Server Error", "Failed to list products");
  }
}
