import { z } from "zod";

const dateRegex = /^\d{4}-\d{2}-\d{2}$/;

export const invoiceSchema = z.object({
  vendorName: z.string().trim().min(1).nullable(),
  invoiceDate: z.string().regex(dateRegex).nullable().optional(),
  lineItems: z
    .array(
      z.object({
        lineNo: z.number().int().positive(),
        productName: z.string().trim().min(1),
        spec: z.string().trim().nullable().optional(),
        quantity: z.number().nullable().optional(),
        unitPrice: z.number().nullable().optional(),
        amount: z.number().nullable().optional(),
        confidence: z.number().min(0).max(1).nullable().optional(),
      }),
    )
    .max(500),
});

export type ParsedInvoice = z.infer<typeof invoiceSchema>;

export const invoiceResponseSchema = {
  type: "object",
  properties: {
    vendorName: { type: ["string", "null"] },
    invoiceDate: { type: ["string", "null"], pattern: "\\d{4}-\\d{2}-\\d{2}" },
    lineItems: {
      type: "array",
      items: {
        type: "object",
        properties: {
          lineNo: { type: "number" },
          productName: { type: "string" },
          spec: { type: ["string", "null"] },
          quantity: { type: ["number", "null"] },
          unitPrice: { type: ["number", "null"] },
          amount: { type: ["number", "null"] },
          confidence: { type: ["number", "null"], minimum: 0, maximum: 1 },
        },
        required: ["lineNo", "productName"],
      },
    },
  },
  required: ["vendorName", "lineItems"],
} as const;
