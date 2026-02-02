import { NextResponse } from "next/server";
import { z } from "zod";
import { problemResponse } from "@/app/api/_utils/problem";
import { listDocuments } from "@/services/documents/repository";
import { registerDocument } from "@/services/documents/service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const createDocumentSchema = z.object({
  fileName: z.string().trim().min(1).max(255),
  storageKey: z.string().trim().min(1),
  fileHash: z.string().trim().min(1),
  uploadNote: z.string().trim().max(1000).optional(),
});

export async function GET() {
  try {
    const items = await listDocuments();
    return NextResponse.json({ items });
  } catch (error) {
    console.error("[documents] list failed", error);
    return problemResponse(500, "Internal Server Error", "Failed to list documents");
  }
}

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const parsed = createDocumentSchema.safeParse(body);
    if (!parsed.success) {
      return problemResponse(400, "Bad Request", "Invalid payload", parsed.error.flatten());
    }

    const outcome = await registerDocument(parsed.data);
    if (!outcome.ok) {
      return problemResponse(outcome.status, outcome.title, outcome.detail);
    }

    return NextResponse.json(outcome.data, { status: 201 });
  } catch (error) {
    console.error("[documents] register failed", error);
    return problemResponse(500, "Internal Server Error", "Failed to register document");
  }
}
