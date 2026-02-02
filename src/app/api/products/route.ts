import { NextResponse } from "next/server";
import { problemResponse } from "@/app/api/_utils/problem";
import { listProducts } from "@/services/products/repository";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const items = await listProducts();
    return NextResponse.json({ items });
  } catch (error) {
    console.error("[products] list failed", error);
    return problemResponse(500, "Internal Server Error", "Failed to list products");
  }
}
