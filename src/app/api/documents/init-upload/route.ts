import { NextResponse } from "next/server";
import { problemResponse } from "@/app/api/_utils/problem";
import { initUploadSchema, validateInitUpload } from "@/services/documents/upload";
import { getStorageProvider } from "@/services/storage";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const parsed = initUploadSchema.safeParse(body);
    if (!parsed.success) {
      return problemResponse(400, "Bad Request", "Invalid payload", parsed.error.flatten());
    }

    const validation = validateInitUpload(parsed.data);
    if (!validation.ok) {
      return problemResponse(validation.status, validation.title, validation.detail);
    }

    const storage = getStorageProvider();
    const result = await storage.createUploadUrl(parsed.data);
    return NextResponse.json(result);
  } catch (error) {
    console.error("[documents] init-upload failed", error);
    return problemResponse(500, "Internal Server Error", "Failed to initialize upload");
  }
}
