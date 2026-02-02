import { z } from "zod";

const dateRegex = /^\d{4}-\d{2}-\d{2}$/;

export const invoiceSchema = z.object({
  vendor_name: z.string().trim().min(1),
  invoice_date: z.string().regex(dateRegex).nullable().optional(),
  line_items: z
    .array(
      z.object({
        product_name: z.string().trim().min(1),
        spec: z.string().trim().nullable().optional(),
        quantity: z.number().nullable().optional(),
        unit_price: z.number().nullable().optional(),
        amount: z.number().nullable().optional(),
        model_confidence: z.number().min(0).max(1).nullable().optional(),
      }),
    )
    .max(500),
});

export type ParsedInvoice = z.infer<typeof invoiceSchema>;

export const invoiceResponseSchema = {
  type: "object",
  properties: {
    vendor_name: { type: "string" },
    invoice_date: { type: ["string", "null"], pattern: "\\d{4}-\\d{2}-\\d{2}" },
    line_items: {
      type: "array",
      items: {
        type: "object",
        properties: {
          product_name: { type: "string" },
          spec: { type: ["string", "null"] },
          quantity: { type: ["number", "null"] },
          unit_price: { type: ["number", "null"] },
          amount: { type: ["number", "null"] },
          model_confidence: { type: ["number", "null"], minimum: 0, maximum: 1 },
        },
        required: ["product_name"],
      },
    },
  },
  required: ["vendor_name", "line_items"],
} as const;
