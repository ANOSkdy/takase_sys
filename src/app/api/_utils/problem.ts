import { NextResponse } from "next/server";

export type ProblemDetails = {
  title: string;
  detail: string;
  status: number;
  errors?: unknown;
};

export function problemResponse(
  status: number,
  title: string,
  detail: string,
  errors?: unknown,
): NextResponse {
  const body: ProblemDetails = { title, detail, status, ...(errors ? { errors } : {}) };
  return new NextResponse(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/problem+json; charset=utf-8" },
  });
}
