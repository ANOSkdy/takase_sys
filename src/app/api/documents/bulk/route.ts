import { NextResponse } from "next/server";
import { z } from "zod";
import { problemResponse } from "@/app/api/_utils/problem";
import { registerDocumentBulk } from "@/services/documents/service";

export const runtime = "nodejs";

const bulkSchema = z.object({
  fileName: z.string().trim().min(1).max(255),
  uploadNote: z.string().trim().max(1000).optional(),
  sourceFileHash: z.string().trim().min(1).optional(),
  pages: z
    .array(
      z.object({
        storageKey: z.string().trim().min(1),
        fileHash: z.string().trim().min(1),
        pageNumber: z.number().int().positive(),
        pageTotal: z.number().int().positive(),
      }),
    )
    .min(1),
});

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const parsed = bulkSchema.safeParse(body);
    if (!parsed.success) {
      return problemResponse(400, "Bad Request", "Invalid payload", parsed.error.flatten());
    }

    const outcome = await registerDocumentBulk(parsed.data);
    if (!outcome.ok) {
      return problemResponse(outcome.status, outcome.title, outcome.detail);
    }

    return NextResponse.json(outcome.data, { status: 201 });
  } catch (error) {
    console.error("[documents] bulk register failed", error);
    return problemResponse(500, "Internal Server Error", "Failed to bulk register documents");
  }
}
