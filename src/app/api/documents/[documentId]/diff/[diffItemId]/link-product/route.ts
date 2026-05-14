import { NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { getDb } from "@/db/client";
import {
  documentDiffItems,
  documentLineItems,
  documentParseRuns,
  productMaster,
  vendorPrices,
} from "@/db/schema";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const paramsSchema = z.object({
  documentId: z.string().uuid(),
  diffItemId: z.string().uuid(),
});

const formSchema = z.object({
  productId: z.string().uuid(),
});

function textValue(value: FormDataEntryValue | null): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function normalizeJsonObject(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function stringOrNull(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

export async function POST(req: Request, context: { params: Promise<{ documentId: string; diffItemId: string }> }) {
  const parsedParams = paramsSchema.safeParse(await context.params);
  if (!parsedParams.success) {
    return NextResponse.json({ error: "Invalid params" }, { status: 400 });
  }

  const formData = await req.formData();
  const parsedForm = formSchema.safeParse({ productId: textValue(formData.get("productId")) });
  if (!parsedForm.success) {
    return NextResponse.json({ error: "Invalid productId" }, { status: 400 });
  }

  const { documentId, diffItemId } = parsedParams.data;
  const { productId } = parsedForm.data;
  const db = getDb();

  await db.transaction(async (tx) => {
    const [diff] = await tx
      .select({
        diffItemId: documentDiffItems.diffItemId,
        parseRunId: documentDiffItems.parseRunId,
        lineItemId: documentDiffItems.lineItemId,
        vendorName: documentDiffItems.vendorName,
        invoiceDate: documentDiffItems.invoiceDate,
        after: documentDiffItems.after,
      })
      .from(documentDiffItems)
      .where(eq(documentDiffItems.diffItemId, diffItemId))
      .limit(1);

    if (!diff) {
      throw new Error("DIFF_ITEM_NOT_FOUND");
    }

    const [run] = await tx
      .select({ parseRunId: documentParseRuns.parseRunId })
      .from(documentParseRuns)
      .where(
        and(
          eq(documentParseRuns.parseRunId, diff.parseRunId),
          eq(documentParseRuns.documentId, documentId),
        ),
      )
      .limit(1);

    if (!run) {
      throw new Error("DIFF_ITEM_DOCUMENT_MISMATCH");
    }

    const [product] = await tx
      .select({
        productId: productMaster.productId,
        productKey: productMaster.productKey,
        productName: productMaster.productName,
        spec: productMaster.spec,
        category: productMaster.category,
      })
      .from(productMaster)
      .where(eq(productMaster.productId, productId))
      .limit(1);

    if (!product) {
      throw new Error("PRODUCT_NOT_FOUND");
    }

    const [existingVendor] = diff.vendorName
      ? await tx
          .select({
            unitPrice: vendorPrices.unitPrice,
            priceUpdatedOn: vendorPrices.priceUpdatedOn,
          })
          .from(vendorPrices)
          .where(
            and(eq(vendorPrices.productId, productId), eq(vendorPrices.vendorName, diff.vendorName)),
          )
          .limit(1)
      : [];

    const after = normalizeJsonObject(diff.after);
    const afterUnitPrice = stringOrNull(after.unitPrice);
    const afterSpec = stringOrNull(after.spec);
    const beforeUnitPrice = existingVendor?.unitPrice ?? null;

    const hasPriceChange =
      afterUnitPrice !== null && (beforeUnitPrice === null || afterUnitPrice !== beforeUnitPrice);
    const hasSpecChange = afterSpec !== null && afterSpec !== (product.spec ?? null);

    let classification = hasPriceChange || hasSpecChange ? "UPDATE" : "NO_CHANGE";
    let reason: string | null = "LINKED_TO_EXISTING_PRODUCT";

    if (hasPriceChange && !diff.vendorName) {
      classification = "BLOCKED";
      reason = "VENDOR_REQUIRED_FOR_PRICE_UPDATE";
    }

    const before: Record<string, unknown> = {
      productId: product.productId,
      productKey: product.productKey,
      productName: product.productName,
      spec: product.spec ?? null,
      category: product.category ?? null,
    };

    if (existingVendor) {
      before.unitPrice = existingVendor.unitPrice;
      before.priceUpdatedOn = existingVendor.priceUpdatedOn;
    }

    await tx
      .update(documentLineItems)
      .set({ matchedProductId: product.productId })
      .where(eq(documentLineItems.lineItemId, diff.lineItemId));

    await tx
      .update(documentDiffItems)
      .set({
        classification,
        reason,
        before,
        after: {
          ...after,
          linkedProductId: product.productId,
          linkedProductKey: product.productKey,
          inheritedCategory: product.category ?? null,
        },
      })
      .where(eq(documentDiffItems.diffItemId, diff.diffItemId));
  });

  return NextResponse.redirect(new URL(`/documents/${documentId}/diff`, req.url), 303);
}
