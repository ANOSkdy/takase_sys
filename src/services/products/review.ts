import { and, eq, inArray, ne } from "drizzle-orm";
import type { PgQueryResultHKT } from "drizzle-orm/pg-core";
import { z } from "zod";
import {
  productDocumentSources,
  productMaster,
  productReviewHistory,
  updateHistory,
  vendorPrices,
} from "@/db/schema";
import type { AppDb } from "@/db/types";
import { makeProductKey, normalizeText } from "@/domain/normalize";
import { toReviewStatus, type ReviewStatus } from "@/domain/review-status";
import { isMergeTargetStatus } from "@/services/products/candidates";

/**
 * 商品の確認操作（確定・再確認依頼・修正・統合）。
 *
 * - 対象商品（統合では統合先も）を行ロックし、画面が読み込んだ時点の更新日時と比較する。
 *   一致しなければ何も書き込まず STALE を返す（二重送信や同時操作で履歴・価格を重複させない）。
 * - 商品・価格・出典・履歴は同一トランザクションで更新する。
 * - 確認者名は入力値の記録であり、本人認証の証跡ではない（アプリ内認証なし）。
 */

const MANUAL_SOURCE_TYPE = "MANUAL_REVIEW";

const reviewerSchema = z.string().trim().min(1, "確認者名を入力してください。").max(100);
const tokenSchema = z.string().trim().min(1).max(64);
const noteSchema = z.string().trim().max(500).optional();
const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .nullish()
    .transform((value) => (value ? value : null));

export const PRICE_CHOICES = ["KEEP_TARGET", "USE_SOURCE"] as const;
export type PriceChoice = (typeof PRICE_CHOICES)[number];

export const reviewActionSchema = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("VERIFY"),
    reviewedBy: reviewerSchema,
    expectedUpdatedAt: tokenSchema,
    note: noteSchema,
  }),
  z.object({
    action: z.literal("REQUEST_REVIEW"),
    reviewedBy: reviewerSchema,
    expectedUpdatedAt: tokenSchema,
    reason: z.string().trim().min(1, "理由を入力してください。").max(500),
  }),
  z.object({
    action: z.literal("CORRECT"),
    reviewedBy: reviewerSchema,
    expectedUpdatedAt: tokenSchema,
    note: noteSchema,
    productName: z.string().trim().min(1, "品名を入力してください。").max(300),
    productMaker: optionalText(200),
    spec: optionalText(500),
    category: optionalText(200),
    prices: z
      .array(
        z.object({
          vendorPriceId: z.string().uuid(),
          unitPrice: z.coerce.number().min(0).max(999999999),
        }),
      )
      .max(200)
      .default([]),
  }),
  z.object({
    action: z.literal("MERGE"),
    reviewedBy: reviewerSchema,
    expectedUpdatedAt: tokenSchema,
    note: noteSchema,
    targetProductId: z.string().uuid(),
    targetExpectedUpdatedAt: tokenSchema,
    /** 同じ仕入先で単価が異なる場合の選択（キーは仕入先名）。 */
    priceChoices: z.record(z.string(), z.enum(PRICE_CHOICES)).default({}),
  }),
]);

export type ReviewActionInput = z.infer<typeof reviewActionSchema>;

export type MergePriceConflict = {
  vendorName: string;
  sourceUnitPrice: string;
  sourcePriceUpdatedOn: string | null;
  targetUnitPrice: string;
  targetPriceUpdatedOn: string | null;
};

export type ReviewFailureCode =
  | "NOT_FOUND"
  | "STALE"
  | "INVALID_STATE"
  | "INVALID_TARGET"
  | "KEY_CONFLICT"
  | "NO_CHANGE"
  | "PRICE_CHOICE_REQUIRED";

export type ReviewResult =
  | {
      ok: true;
      productId: string;
      reviewStatus: ReviewStatus;
      /** 統合した場合の統合先。 */
      mergedIntoProductId?: string;
    }
  | {
      ok: false;
      code: ReviewFailureCode;
      message: string;
      conflictingProductId?: string;
      priceConflicts?: MergePriceConflict[];
    };

const STALE_MESSAGE =
  "他の操作でこの商品が更新されています。画面を再読み込みして内容を確認してください。";

function failure(
  code: ReviewFailureCode,
  message: string,
  extra: Partial<Extract<ReviewResult, { ok: false }>> = {},
): ReviewResult {
  return { ok: false, code, message, ...extra };
}

function samePrice(a: string, b: string | number): boolean {
  return Number(a).toFixed(2) === Number(b).toFixed(2);
}

const productColumns = {
  productId: productMaster.productId,
  productKey: productMaster.productKey,
  productName: productMaster.productName,
  productMaker: productMaster.productMaker,
  spec: productMaster.spec,
  category: productMaster.category,
  reviewStatus: productMaster.reviewStatus,
  mergedIntoProductId: productMaster.mergedIntoProductId,
  lastUpdatedAt: productMaster.lastUpdatedAt,
};

const priceColumns = {
  vendorPriceId: vendorPrices.vendorPriceId,
  productId: vendorPrices.productId,
  vendorName: vendorPrices.vendorName,
  unitPrice: vendorPrices.unitPrice,
  priceUpdatedOn: vendorPrices.priceUpdatedOn,
  sourceType: vendorPrices.sourceType,
  sourceId: vendorPrices.sourceId,
};

export async function applyReviewAction<H extends PgQueryResultHKT>(
  db: AppDb<H>,
  productId: string,
  input: ReviewActionInput,
): Promise<ReviewResult> {
  return db.transaction(async (tx) => {
    const lockIds =
      input.action === "MERGE" ? [productId, input.targetProductId].sort() : [productId];
    // デッドロックを避けるため、常にID順でロックする。
    const locked = await tx
      .select(productColumns)
      .from(productMaster)
      .where(inArray(productMaster.productId, lockIds))
      .orderBy(productMaster.productId)
      .for("update");

    const product = locked.find((row) => row.productId === productId);
    if (!product) return failure("NOT_FOUND", "商品が見つかりません。");
    if (product.lastUpdatedAt.toISOString() !== input.expectedUpdatedAt) {
      return failure("STALE", STALE_MESSAGE);
    }

    const status = toReviewStatus(product.reviewStatus);
    if (status === "MERGED") {
      return failure("INVALID_STATE", "統合済みの商品は操作できません。統合先を確認してください。");
    }

    const now = new Date();
    const reviewId = crypto.randomUUID();
    const productSnapshot = {
      productKey: product.productKey,
      productName: product.productName,
      productMaker: product.productMaker ?? null,
      spec: product.spec ?? null,
      category: product.category ?? null,
      reviewStatus: status,
    };
    const priceHistory = (row: {
      productId: string;
      vendorPriceId: string;
      vendorName: string;
      before: string | null;
      after: string;
    }) => ({
      historyId: crypto.randomUUID(),
      updateKey: `${reviewId}:${row.vendorPriceId}:unit_price`,
      productId: row.productId,
      fieldName: "unit_price",
      vendorName: row.vendorName,
      beforeValue: row.before,
      afterValue: row.after,
      sourceType: MANUAL_SOURCE_TYPE,
      sourceId: reviewId,
      updatedAt: now,
      updatedBy: input.reviewedBy,
    });

    if (input.action === "VERIFY") {
      if (status === "VERIFIED") return failure("INVALID_STATE", "この商品は既に確認済みです。");
      await tx
        .update(productMaster)
        .set({
          reviewStatus: "VERIFIED",
          reviewedAt: now,
          reviewedBy: input.reviewedBy,
          lastUpdatedAt: now,
        })
        .where(eq(productMaster.productId, productId));
      await tx.insert(productReviewHistory).values({
        reviewId,
        productId,
        action: "VERIFY",
        beforeSnapshot: productSnapshot,
        afterSnapshot: { ...productSnapshot, reviewStatus: "VERIFIED" },
        note: input.note || null,
        reviewedAt: now,
        reviewedBy: input.reviewedBy,
      });
      return { ok: true, productId, reviewStatus: "VERIFIED" };
    }

    if (input.action === "REQUEST_REVIEW") {
      if (status === "NEEDS_REVIEW") {
        return failure("INVALID_STATE", "この商品は既に要確認です。");
      }
      await tx
        .update(productMaster)
        .set({
          reviewStatus: "NEEDS_REVIEW",
          reviewedAt: now,
          reviewedBy: input.reviewedBy,
          lastUpdatedAt: now,
        })
        .where(eq(productMaster.productId, productId));
      await tx.insert(productReviewHistory).values({
        reviewId,
        productId,
        action: "REQUEST_REVIEW",
        beforeSnapshot: productSnapshot,
        afterSnapshot: { ...productSnapshot, reviewStatus: "NEEDS_REVIEW" },
        note: input.reason,
        reviewedAt: now,
        reviewedBy: input.reviewedBy,
      });
      return { ok: true, productId, reviewStatus: "NEEDS_REVIEW" };
    }

    if (input.action === "CORRECT") {
      const next = {
        productName: normalizeText(input.productName),
        productMaker: input.productMaker ? normalizeText(input.productMaker) : null,
        spec: input.spec ? normalizeText(input.spec) : null,
        category: input.category ? normalizeText(input.category) : null,
      };
      if (!next.productName) return failure("INVALID_STATE", "品名を入力してください。");

      // 品名・規格・メーカーを直したら商品キーも作り直す（次回以降の取込が修正後の商品に一致するように）。
      const identityChanged =
        next.productName !== product.productName ||
        next.productMaker !== (product.productMaker ?? null) ||
        next.spec !== (product.spec ?? null);
      const nextKey = identityChanged
        ? makeProductKey(next.productName, next.spec, next.productMaker)
        : product.productKey;
      if (nextKey !== product.productKey) {
        const [duplicate] = await tx
          .select({ productId: productMaster.productId })
          .from(productMaster)
          .where(and(eq(productMaster.productKey, nextKey), ne(productMaster.productId, productId)))
          .limit(1);
        if (duplicate) {
          return failure(
            "KEY_CONFLICT",
            "修正後と同じ内容（メーカー・品名・規格）の商品が既にあります。修正ではなく統合を検討してください。",
            { conflictingProductId: duplicate.productId },
          );
        }
      }

      const currentPrices = input.prices.length
        ? await tx
            .select(priceColumns)
            .from(vendorPrices)
            .where(eq(vendorPrices.productId, productId))
            .for("update")
        : [];
      const priceChanges: {
        vendorPriceId: string;
        vendorName: string;
        before: string;
        after: string;
      }[] = [];
      for (const requested of input.prices) {
        const current = currentPrices.find((row) => row.vendorPriceId === requested.vendorPriceId);
        if (!current) return failure("STALE", STALE_MESSAGE);
        if (samePrice(current.unitPrice, requested.unitPrice)) continue;
        priceChanges.push({
          vendorPriceId: current.vendorPriceId,
          vendorName: current.vendorName,
          before: current.unitPrice,
          after: requested.unitPrice.toFixed(2),
        });
      }

      const productChanged = identityChanged || next.category !== (product.category ?? null);
      if (!productChanged && priceChanges.length === 0) {
        return failure("NO_CHANGE", "変更がありません。");
      }

      // 修正だけでは確認済みにしない。状態は変えない。
      await tx
        .update(productMaster)
        .set({
          productKey: nextKey,
          productName: next.productName,
          productMaker: next.productMaker,
          spec: next.spec,
          category: next.category,
          lastUpdatedAt: now,
          lastSourceType: MANUAL_SOURCE_TYPE,
          lastSourceId: reviewId,
        })
        .where(eq(productMaster.productId, productId));

      for (const change of priceChanges) {
        await tx
          .update(vendorPrices)
          .set({
            unitPrice: change.after,
            sourceType: MANUAL_SOURCE_TYPE,
            sourceId: reviewId,
            updatedAt: now,
          })
          .where(eq(vendorPrices.vendorPriceId, change.vendorPriceId));
        await tx.insert(updateHistory).values(
          priceHistory({
            productId,
            vendorPriceId: change.vendorPriceId,
            vendorName: change.vendorName,
            before: change.before,
            after: change.after,
          }),
        );
      }

      await tx.insert(productReviewHistory).values({
        reviewId,
        productId,
        action: "CORRECT",
        beforeSnapshot: {
          ...productSnapshot,
          prices: priceChanges.map(({ vendorName, before }) => ({ vendorName, unitPrice: before })),
        },
        afterSnapshot: {
          productKey: nextKey,
          ...next,
          reviewStatus: status,
          prices: priceChanges.map(({ vendorName, after }) => ({ vendorName, unitPrice: after })),
        },
        note: input.note || null,
        reviewedAt: now,
        reviewedBy: input.reviewedBy,
      });
      return { ok: true, productId, reviewStatus: status };
    }

    // ---- MERGE
    if (input.targetProductId === productId) {
      return failure("INVALID_TARGET", "自分自身には統合できません。");
    }
    const target = locked.find((row) => row.productId === input.targetProductId);
    if (!target) return failure("INVALID_TARGET", "統合先の商品が見つかりません。");
    const targetStatus = toReviewStatus(target.reviewStatus);
    // 統合先は統合済みでない商品に限るため、統合の循環は起きない。
    if (!isMergeTargetStatus(targetStatus)) {
      return failure(
        "INVALID_TARGET",
        "統合先にできるのは、確認済みまたは既存データの商品だけです。",
      );
    }
    if (target.lastUpdatedAt.toISOString() !== input.targetExpectedUpdatedAt) {
      return failure(
        "STALE",
        "統合先の商品が更新されています。画面を再読み込みして候補を確認し直してください。",
      );
    }

    const allPrices = await tx
      .select(priceColumns)
      .from(vendorPrices)
      .where(inArray(vendorPrices.productId, [productId, target.productId]))
      .for("update");
    const sourcePrices = allPrices.filter((row) => row.productId === productId);
    const targetPrices = new Map(
      allPrices.filter((row) => row.productId === target.productId).map((r) => [r.vendorName, r]),
    );

    // 同じ仕入先で単価が違う場合は自動で上書きせず、利用者の選択を必須にする。
    const conflicts: MergePriceConflict[] = [];
    for (const sourcePrice of sourcePrices) {
      const targetPrice = targetPrices.get(sourcePrice.vendorName);
      if (!targetPrice || samePrice(sourcePrice.unitPrice, targetPrice.unitPrice)) continue;
      if (input.priceChoices[sourcePrice.vendorName]) continue;
      conflicts.push({
        vendorName: sourcePrice.vendorName,
        sourceUnitPrice: sourcePrice.unitPrice,
        sourcePriceUpdatedOn: sourcePrice.priceUpdatedOn,
        targetUnitPrice: targetPrice.unitPrice,
        targetPriceUpdatedOn: targetPrice.priceUpdatedOn,
      });
    }
    if (conflicts.length) {
      return failure(
        "PRICE_CHOICE_REQUIRED",
        "同じ仕入先で単価が異なります。どちらを残すか選択してください。",
        { priceConflicts: conflicts },
      );
    }

    const priceOutcomes: Record<string, unknown>[] = [];
    for (const sourcePrice of sourcePrices) {
      const targetPrice = targetPrices.get(sourcePrice.vendorName);
      if (!targetPrice) {
        // 統合先にこの仕入先の単価がない: そのまま移す。
        await tx
          .update(vendorPrices)
          .set({ productId: target.productId, updatedAt: now })
          .where(eq(vendorPrices.vendorPriceId, sourcePrice.vendorPriceId));
        await tx.insert(updateHistory).values(
          priceHistory({
            productId: target.productId,
            vendorPriceId: sourcePrice.vendorPriceId,
            vendorName: sourcePrice.vendorName,
            before: null,
            after: sourcePrice.unitPrice,
          }),
        );
        priceOutcomes.push({
          vendorName: sourcePrice.vendorName,
          outcome: "MOVED",
          unitPrice: sourcePrice.unitPrice,
        });
        continue;
      }

      const same = samePrice(sourcePrice.unitPrice, targetPrice.unitPrice);
      const choice: PriceChoice = same
        ? "KEEP_TARGET"
        : (input.priceChoices[sourcePrice.vendorName] ?? "KEEP_TARGET");
      if (choice === "USE_SOURCE") {
        await tx
          .update(vendorPrices)
          .set({
            unitPrice: sourcePrice.unitPrice,
            priceUpdatedOn: sourcePrice.priceUpdatedOn,
            sourceType: MANUAL_SOURCE_TYPE,
            sourceId: reviewId,
            updatedAt: now,
          })
          .where(eq(vendorPrices.vendorPriceId, targetPrice.vendorPriceId));
        await tx.insert(updateHistory).values(
          priceHistory({
            productId: target.productId,
            vendorPriceId: targetPrice.vendorPriceId,
            vendorName: sourcePrice.vendorName,
            before: targetPrice.unitPrice,
            after: sourcePrice.unitPrice,
          }),
        );
      }
      // 統合元の単価行は残さない（値は履歴の変更前スナップショットに保存する）。
      await tx
        .delete(vendorPrices)
        .where(eq(vendorPrices.vendorPriceId, sourcePrice.vendorPriceId));
      priceOutcomes.push({
        vendorName: sourcePrice.vendorName,
        outcome: same ? "SAME" : choice,
        sourceUnitPrice: sourcePrice.unitPrice,
        targetUnitPrice: targetPrice.unitPrice,
      });
    }

    // 出典を統合先へ付け替える。
    const movedSources = await tx
      .update(productDocumentSources)
      .set({ productId: target.productId })
      .where(eq(productDocumentSources.productId, productId))
      .returning({ lineItemId: productDocumentSources.lineItemId });

    // 過去にこの商品へ統合された商品も、統合先を直接指すようにする（たどる段数を増やさない）。
    await tx
      .update(productMaster)
      .set({ mergedIntoProductId: target.productId })
      .where(eq(productMaster.mergedIntoProductId, productId));

    // 統合元は削除せず MERGED として残す。
    await tx
      .update(productMaster)
      .set({
        reviewStatus: "MERGED",
        mergedIntoProductId: target.productId,
        reviewedAt: now,
        reviewedBy: input.reviewedBy,
        lastUpdatedAt: now,
      })
      .where(eq(productMaster.productId, productId));

    // 統合先の確認状態は変えない。更新日時だけ進め、古い画面からの操作を止める。
    await tx
      .update(productMaster)
      .set({ lastUpdatedAt: now })
      .where(eq(productMaster.productId, target.productId));

    await tx.insert(productReviewHistory).values({
      reviewId,
      productId,
      action: "MERGE",
      targetProductId: target.productId,
      beforeSnapshot: {
        ...productSnapshot,
        prices: sourcePrices.map((row) => ({
          vendorName: row.vendorName,
          unitPrice: row.unitPrice,
          priceUpdatedOn: row.priceUpdatedOn,
        })),
        sourceLineItemIds: movedSources.map((row) => row.lineItemId),
      },
      afterSnapshot: {
        reviewStatus: "MERGED",
        mergedIntoProductId: target.productId,
        targetProductKey: target.productKey,
        targetReviewStatus: targetStatus,
        prices: priceOutcomes,
        movedSourceCount: movedSources.length,
      },
      note: input.note || null,
      reviewedAt: now,
      reviewedBy: input.reviewedBy,
    });

    return {
      ok: true,
      productId,
      reviewStatus: "MERGED",
      mergedIntoProductId: target.productId,
    };
  });
}
