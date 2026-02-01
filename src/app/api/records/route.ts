import { NextResponse } from "next/server";
import { recordSearchSchema, searchRecords } from "@/services/records/search";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function problem(status: number, title: string, detail: string, extra?: unknown) {
  return new NextResponse(JSON.stringify({ title, detail, status, ...(extra ? { extra } : {}) }), {
    status,
    headers: { "content-type": "application/problem+json; charset=utf-8" },
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
    return NextResponse.json(data);
  } catch {
    return problem(500, "Internal Server Error", "Failed to search records");
  }
}
