import { NextResponse } from "next/server";
import { recordSearchSchema, searchRecords } from "@/services/records/search";
import { problemResponse } from "@/app/api/_utils/problem";
import { createRecord, createRecordSchema } from "@/services/records/repository";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

const noStoreHeaders = {
  "Cache-Control": "no-store, max-age=0",
  "Content-Type": "application/json; charset=utf-8",
};

function problem(status: number, title: string, detail: string, extra?: unknown) {
  return new NextResponse(JSON.stringify({ title, detail, status, ...(extra ? { extra } : {}) }), {
    status,
    headers: {
      "cache-control": "no-store, max-age=0",
      "content-type": "application/problem+json; charset=utf-8",
    },
  });
}

export async function GET(req: Request) {
  try {
    const url = new URL(req.url);
    const raw = Object.fromEntries(url.searchParams.entries());
    const parsed = recordSearchSchema.safeParse(raw);
    if (!parsed.success) {
      return problem(400, "Bad Request", "Invalid query parameters", parsed.error.flatten());
    }

    const data = await searchRecords(parsed.data);
    return NextResponse.json(data, { headers: noStoreHeaders });
  } catch {
    return problem(500, "Internal Server Error", "Failed to search records");
  }
}

export async function POST(req: Request) {
  const rawBody = await req.json().catch(() => null);
  const parsedBody = createRecordSchema.safeParse(rawBody);
  if (!parsedBody.success) {
    return problemResponse(400, "Bad Request", "Invalid request body", parsedBody.error.flatten());
  }

  try {
    const created = await createRecord(parsedBody.data);
    return NextResponse.json(created, { status: 201, headers: noStoreHeaders });
  } catch {
    return problemResponse(500, "Internal Server Error", "Failed to create record");
  }
}
