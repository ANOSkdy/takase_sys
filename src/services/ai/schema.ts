import { z } from "zod";

export const lineItemSchema = z.object({
  line_no: z.number().int().min(1),
  product_name: z.string().trim().min(1).nullable(),
  spec: z.string().trim().nullable(),
  quantity: z.number().nullable(),
  unit_price: z.number().nullable(),
  amount: z.number().nullable(),
  confidence: z.number().min(0).max(1).nullable(),
});

export const documentExtractSchema = z.object({
  vendor_name: z.string().trim().min(1).nullable(),
  invoice_date: z.string().trim().nullable(),
  line_items: z.array(lineItemSchema),
});

export type DocumentExtractResult = z.infer<typeof documentExtractSchema>;
