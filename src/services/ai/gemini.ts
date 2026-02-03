import "server-only";
import { getEnv, requireEnv } from "@/config/env";
import { invoiceResponseSchema, invoiceSchema, type ParsedInvoice } from "@/services/ai/schema";
import { SYSTEM_PROMPT } from "@/services/ai/prompt";

type GeminiResponse = {
  candidates?: Array<{
    content?: { parts?: Array<{ text?: string }> };
  }>;
};

function extractJsonText(response: GeminiResponse): string | null {
  const parts = response.candidates?.[0]?.content?.parts ?? [];
  for (const part of parts) {
    if (part.text) return part.text;
  }
  return null;
}

export async function parseInvoiceFromPdf(pdfBase64: string): Promise<ParsedInvoice> {
  const env = getEnv();
  const apiKey = requireEnv(env.GEMINI_API_KEY, "GEMINI_API_KEY");
  const model = requireEnv(env.GEMINI_MODEL, "GEMINI_MODEL");

  const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;
  const body = {
    contents: [
      {
        role: "user",
        parts: [
          { text: SYSTEM_PROMPT },
          {
            inline_data: {
              mime_type: "application/pdf",
              data: pdfBase64,
            },
          },
        ],
      },
    ],
    generationConfig: {
      response_mime_type: "application/json",
      responseSchema: invoiceResponseSchema,
    },
  };

  const response = await fetch(endpoint, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    throw new Error(`Gemini API failed: ${response.status}`);
  }

  const data = (await response.json()) as GeminiResponse;
  const text = extractJsonText(data);
  if (!text) {
    throw new Error("Gemini response missing content");
  }

  const parsed = invoiceSchema.safeParse(JSON.parse(text));
  if (!parsed.success) {
    throw new Error("Gemini response validation failed");
  }

  return parsed.data;
}
