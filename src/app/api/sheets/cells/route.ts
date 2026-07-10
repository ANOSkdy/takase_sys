import { NextResponse } from "next/server";
import { problemResponse } from "@/app/api/_utils/problem";
import {
  ProductSheetCellsNotFoundError,
  updateProductSheetCells,
  updateProductSheetCellsSchema,
} from "@/services/records/sheets";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function PATCH(request: Request) {
  const rawBody = await request.json().catch(() => null);
  const parsedBody = updateProductSheetCellsSchema.safeParse(rawBody);
  if (!parsedBody.success) {
    return problemResponse(400, "Bad Request", "Invalid sheet cell update payload");
  }

  try {
    const result = await updateProductSheetCells(null, parsedBody.data);
    return NextResponse.json({ ok: true, changedCount: result.changedCount, grid: result.grid });
  } catch (error) {
    if (error instanceof ProductSheetCellsNotFoundError) {
      return problemResponse(404, "Not Found", "One or more vendor price cells were not found");
    }
    console.error("[sheets] batch cell update failed", error);
    return problemResponse(500, "Internal Server Error", "Failed to update sheet cells");
  }
}
