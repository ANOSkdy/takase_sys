import { NextResponse } from "next/server";
import { z } from "zod";
import { problemResponse } from "@/app/api/_utils/problem";
import {
  getRecordById,
  recordIdSchema,
  updateRecordById,
  updateRecordSchema,
} from "@/services/records/repository";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const duplicateKeyErrorSchema = z.object({ code: z.literal("23505") });

export async function GET(_req: Request, context: { params: Promise<{ recordId: string }> }) {
  const parsedParams = recordIdSchema.safeParse(await context.params);
  if (!parsedParams.success) {
    return problemResponse(400, "Bad Request", "Invalid recordId", parsedParams.error.flatten());
  }

  try {
    const record = await getRecordById(parsedParams.data.recordId);
    if (!record) {
      return problemResponse(404, "Not Found", "Record not found");
    }
    return NextResponse.json(record);
  } catch (error) {
    console.error("[records] detail failed", error);
    return problemResponse(500, "Internal Server Error", "Failed to fetch record");
  }
}

export async function PATCH(req: Request, context: { params: Promise<{ recordId: string }> }) {
  const parsedParams = recordIdSchema.safeParse(await context.params);
  if (!parsedParams.success) {
    return problemResponse(400, "Bad Request", "Invalid recordId", parsedParams.error.flatten());
  }

  const rawBody = await req.json().catch(() => null);
  const parsedBody = updateRecordSchema.safeParse(rawBody);
  if (!parsedBody.success) {
    return problemResponse(400, "Bad Request", "Invalid request body", parsedBody.error.flatten());
  }

  try {
    const updated = await updateRecordById(parsedParams.data.recordId, parsedBody.data);
    if (!updated) {
      return problemResponse(404, "Not Found", "Record not found");
    }
    return NextResponse.json(updated);
  } catch (error) {
    if (duplicateKeyErrorSchema.safeParse(error).success) {
      return problemResponse(409, "Conflict", "Vendor name already exists for this product");
    }

    console.error("[records] update failed", error);
    return problemResponse(500, "Internal Server Error", "Failed to update record");
  }
}
