import { problemResponse } from "@/app/api/_utils/problem";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST() {
  return problemResponse(501, "Not Implemented", "Parse API is not implemented in PR1");
}
