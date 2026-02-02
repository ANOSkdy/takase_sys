import { getEnv, requireEnv } from "@/config/env";
import { documentExtractSchema, type DocumentExtractResult } from "@/services/ai/schema";
import { SYSTEM_PROMPT } from "@/services/ai/prompt";

type GeminiSuccess = {
  ok: true;
  data: DocumentExtractResult;
  model: string;
};

type GeminiFailure = {
  ok: false;
  errorSummary: string;
  model: string;
};

type GeminiResponse = {
  candidates?: Array<{
    content?: {
      parts?: Array<{ text?: string }>;
    };
  }>;
};

function toBase64(buffer: ArrayBuffer): string {
  return Buffer.from(buffer).toString("base64");
}

function summarizeError(error: unknown): string {
  if (error instanceof Error) return error.message.slice(0, 200);
  if (typeof error === "string") return error.slice(0, 200);
  return "Unexpected error";
}

export async function extractDocumentFromPdf(
  pdf: ArrayBuffer,
): Promise<GeminiSuccess | GeminiFailure> {
  const env = getEnv();
  const apiKey = requireEnv(env.GEMINI_API_KEY, "GEMINI_API_KEY");
  const model = env.GEMINI_MODEL ?? "gemini-3.0-flash";

  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;

  const body = {
    systemInstruction: {
      parts: [{ text: SYSTEM_PROMPT }],
    },
    contents: [
      {
        role: "user",
        parts: [
          { text: "Extract invoice metadata and line items from this PDF." },
          {
            inlineData: {
              mimeType: "application/pdf",
              data: toBase64(pdf),
            },
          },
        ],
      },
    ],
    generationConfig: {
      responseMimeType: "application/json",
    },
  };

  try {
    const response = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const text = await response.text().catch(() => "");
      return {
        ok: false,
        model,
        errorSummary: `Gemini API error: ${response.status} ${text}`.slice(0, 200),
      };
    }

    const data = (await response.json()) as GeminiResponse;
    const text = data.candidates?.[0]?.content?.parts?.[0]?.text;
    if (!text) {
      return { ok: false, model, errorSummary: "Gemini response missing content" };
    }

    const json = JSON.parse(text) as unknown;
    const parsed = documentExtractSchema.safeParse(json);
    if (!parsed.success) {
      return { ok: false, model, errorSummary: "Gemini response schema invalid" };
    }

    return { ok: true, data: parsed.data, model };
  } catch (error) {
    return { ok: false, model, errorSummary: summarizeError(error) };
  }
}
