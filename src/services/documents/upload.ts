import { z } from "zod";
import { getMaxPdfSizeBytes } from "@/services/documents/constants";

export const initUploadSchema = z.object({
  fileName: z.string().trim().min(1).max(255),
  contentType: z.string().trim().min(1).max(200),
  size: z.number().int().positive(),
});

export type InitUploadInput = z.infer<typeof initUploadSchema>;

export type InitUploadValidationResult =
  | { ok: true }
  | { ok: false; status: number; title: string; detail: string };

export function validateInitUpload(
  input: InitUploadInput,
  maxBytes: number = getMaxPdfSizeBytes(),
): InitUploadValidationResult {
  if (input.contentType !== "application/pdf") {
    return {
      ok: false,
      status: 415,
      title: "Unsupported Media Type",
      detail: "Only application/pdf is accepted",
    };
  }

  if (input.size > maxBytes) {
    return {
      ok: false,
      status: 413,
      title: "Payload Too Large",
      detail: `PDF size exceeds limit (${maxBytes} bytes)`,
    };
  }

  return { ok: true };
}
