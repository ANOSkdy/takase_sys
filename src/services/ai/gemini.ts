import "server-only";
import { getEnv, requireEnv } from "@/config/env";
import {
  invoiceResponseSchema,
  invoiceSchema,
  type ParsedInvoice,
} from "@/services/ai/schema";
import { SYSTEM_PROMPT } from "@/services/ai/prompt";

type GeminiResponse = {
  candidates?: Array<{
    content?: { parts?: Array<{ text?: string }> };
  }>;
};

function extractJsonText(response: GeminiResponse): string | null {
  const parts = response.candidates?.[0]?.content?.parts ?? [];
  for (const part of parts) {
    if (typeof part.text === "string" && part.text.trim()) return part.text;
  }
  return null;
}

function stripJsonCodeFence(text: string): string {
  const trimmed = text.trim();
  // ```json ... ``` / ``` ... ```
  if (trimmed.startsWith("```")) {
    const lines = trimmed.split("\n");
    // drop first line (``` or ```json)
    lines.shift();
    // drop last fence if present
    if (lines.length && lines[lines.length - 1].trim().startsWith("```")) {
      lines.pop();
    }
    return lines.join("\n").trim();
  }
  return trimmed;
}

/**
 * Gemini REST Structured Output expects a standard JSON Schema object.
 * If schema has `properties` represented as an array of { key, value } (protobuf-map-like),
 * normalize it back to an object map recursively.
 */
function normalizeJsonSchema(schema: unknown): unknown {
  if (Array.isArray(schema)) {
    return schema.map((v) => normalizeJsonSchema(v));
  }
  if (!schema || typeof schema !== "object") return schema;

  const obj = schema as Record<string, unknown>;
  const out: Record<string, unknown> = {};

  for (const [k, v] of Object.entries(obj)) {
    if (k === "properties" && Array.isArray(v)) {
      // Convert [{key, value}, ...] => { [key]: value, ... }
      const props: Record<string, unknown> = {};
      for (const item of v) {
        if (!item || typeof item !== "object") continue;
        const it = item as Record<string, unknown>;
        const key = typeof it.key === "string" ? it.key : undefined;
        if (!key) continue;
        props[key] = normalizeJsonSchema(it.value);
      }
      out.properties = props;
      continue;
    }

    out[k] = normalizeJsonSchema(v);
  }

  return out;
}

export async function parseInvoiceFromPdf(pdfBase64: string): Promise<ParsedInvoice> {
  const env = getEnv();
  const apiKey = requireEnv(env.GEMINI_API_KEY, "GEMINI_API_KEY");
  const model = requireEnv(env.GEMINI_MODEL, "GEMINI_MODEL");

  const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`;

  // Ensure schema is a plain JSON Schema object compatible with Gemini structured outputs.
  const responseJsonSchema = normalizeJsonSchema(invoiceResponseSchema);

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
    // REST Structured Output (Gemini API): generationConfig.responseMimeType/responseJsonSchema
    // https://ai.google.dev/gemini-api/docs/structured-output
    generationConfig: {
      responseMimeType: "application/json",
      responseJsonSchema,
    },
  };

  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      // Prefer header auth for REST examples
      "x-goog-api-key": apiKey,
    },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const text = await response.text().catch(() => "");
    throw new Error(
      `GEMINI_API_FAILED ${response.status} ${response.statusText} ${text.slice(0, 800)}`
    );
  }

  const data = (await response.json()) as GeminiResponse;
  const rawText = extractJsonText(data);
  if (!rawText) {
    throw new Error("GEMINI_RESPONSE_EMPTY");
  }

  const jsonText = stripJsonCodeFence(rawText);

  let parsedJson: unknown;
  try {
    parsedJson = JSON.parse(jsonText);
  } catch {
    throw new Error("GEMINI_RESPONSE_INVALID_JSON");
  }

  const parsed = invoiceSchema.safeParse(parsedJson);
  if (!parsed.success) {
    throw new Error("GEMINI_RESPONSE_INVALID_SCHEMA");
  }

  return parsed.data;
}
