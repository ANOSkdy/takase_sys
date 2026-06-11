import { NextResponse } from "next/server";
import { problemResponse } from "@/app/api/_utils/problem";
import {
  ProductSheetCellsNotFoundError,
  updateProductSheetCellsSchema,
  updateProductSheetCellsWithoutCategory,
} from "@/services/records/sheets";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function PATCH(req: Request) {
  const rawBody = await req.json().catch(() => null);
  const parsedBody = updateProductSheetCellsSchema.safeParse(rawBody);
  if (!parsedBody.success) {
    return problemResponse(400, "Bad Request", "Invalid request body", parsedBody.error.flatten());
  }

  try {
    const result = await updateProductSheetCellsWithoutCategory(parsedBody.data);
    return NextResponse.json({ ok: true, ...result });
  } catch (error) {
    if (error instanceof ProductSheetCellsNotFoundError) {
      return problemResponse(404, "Not Found", "One or more vendor price cells were not found");
    }

    console.error("[sheets] batch cell update failed", error);
    return problemResponse(500, "Internal Server Error", "Failed to update sheet cells");
  }
}
