import { NextResponse } from "next/server";
import { z } from "zod";
import { problemResponse } from "@/app/api/_utils/problem";
import { listProducts } from "@/services/products/repository";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const parsedQuery = z
    .object({
      keyword: z.string().trim().min(1).optional(),
      category: z.string().trim().min(1).optional(),
      vendorName: z.string().trim().min(1).optional(),
      qualityFlag: z.string().trim().min(1).optional(),
      limit: z.coerce.number().int().positive().max(200).optional(),
      offset: z.coerce.number().int().min(0).optional(),
    })
    .safeParse(Object.fromEntries(searchParams.entries()));
  if (!parsedQuery.success) {
    return problemResponse(400, "Bad Request", "Invalid query", parsedQuery.error.flatten());
  }

  try {
    const items = await listProducts(parsedQuery.data);
    return NextResponse.json({ items });
  } catch (error) {
    console.error("[products] list failed", error);
    return problemResponse(500, "Internal Server Error", "Failed to list products");
  }
}
