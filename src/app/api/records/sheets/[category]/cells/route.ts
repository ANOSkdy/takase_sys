import { NextResponse } from "next/server";
import { problemResponse } from "@/app/api/_utils/problem";
import {
  ProductSheetCellsNotFoundError,
  productSheetCategoryParamSchema,
  updateProductSheetCells,
  updateProductSheetCellsSchema,
} from "@/services/records/sheets";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function PATCH(req: Request, context: { params: Promise<{ category: string }> }) {
  const parsedParams = productSheetCategoryParamSchema.safeParse(await context.params);
  if (!parsedParams.success) {
    return problemResponse(400, "Bad Request", "Invalid category", parsedParams.error.flatten());
  }

  const rawBody = await req.json().catch(() => null);
  const parsedBody = updateProductSheetCellsSchema.safeParse(rawBody);
  if (!parsedBody.success) {
    return problemResponse(400, "Bad Request", "Invalid request body", parsedBody.error.flatten());
  }

  try {
    const result = await updateProductSheetCells(parsedParams.data.category, parsedBody.data);
    return NextResponse.json({ ok: true, ...result });
  } catch (error) {
    if (error instanceof ProductSheetCellsNotFoundError) {
      return problemResponse(
        404,
        "Not Found",
        "One or more vendor price cells were not found in this category",
      );
    }

    console.error("[records:sheets] batch cell update failed", error);
    return problemResponse(500, "Internal Server Error", "Failed to update sheet cells");
  }
}
