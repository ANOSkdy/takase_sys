import { and, desc, eq, ilike, ne, or, sql, type SQL } from "drizzle-orm";
import type { PgQueryResultHKT } from "drizzle-orm/pg-core";
import { productMaster } from "@/db/schema";
import type { ProductMatchCandidate } from "@/db/schema";
import type { AppDb } from "@/db/types";
import { normalizeText } from "@/domain/normalize";
import {
  compareProducts,
  extractModelTokens,
  type ComparableProduct,
} from "@/domain/product-similarity";
import { toReviewStatus, type ReviewStatus } from "@/domain/review-status";

export type SimilarProductCandidate = {
  productId: string;
  productName: string;
  productMaker: string | null;
  spec: string | null;
  category: string | null;
  reviewStatus: ReviewStatus;
  /** 楽観ロック用。統合時にこの値を送り、候補が更新されていたら統合を止める。 */
  lastUpdatedAt: string;
  matchedFields: string[];
  differingFields: string[];
  /** 統合先にできるか（確認済みまたは既存データのみ）。 */
  mergeable: boolean;
};

const DEFAULT_LIMIT = 5;
const PREFILTER_LIMIT = 300;
const MAX_MODEL_TOKENS = 5;

function likePattern(value: string): string {
  return `%${value.replace(/[\\%_]/g, (match) => `\\${match}`)}%`;
}

/** 統合先にできる状態か。未確認の商品同士は統合させない。 */
export function isMergeTargetStatus(status: ReviewStatus): boolean {
  return status === "VERIFIED" || status === "LEGACY";
}

/**
 * メーカー・品名・型番・規格から類似候補を探す。
 * SQLで粗く絞り込み、一致項目と相違項目の判定はアプリ側で行う。
 * 統合済みと自分自身は除外する。候補は提示のみで、確定した紐付けではない。
 */
export async function findSimilarProducts<H extends PgQueryResultHKT>(
  db: AppDb<H>,
  base: ComparableProduct & { productId?: string | null },
  limit = DEFAULT_LIMIT,
): Promise<SimilarProductCandidate[]> {
  const name = normalizeText(base.productName);
  if (!name) return [];

  const nameConditions: (SQL | undefined)[] = [
    ilike(productMaster.productName, likePattern(name)),
    // 候補の品名が、対象の品名に含まれる場合（例: 対象「ウェザータイト(防水部材)」に対する「ウェザータイト」）
    sql`${name} ILIKE '%' || ${productMaster.productName} || '%'`,
  ];
  if (name.length >= 4) {
    nameConditions.push(ilike(productMaster.productName, likePattern(name.slice(0, 4))));
  }
  const modelTokens = extractModelTokens(`${name} ${base.spec ?? ""}`).slice(0, MAX_MODEL_TOKENS);
  for (const token of modelTokens) {
    nameConditions.push(ilike(productMaster.productName, likePattern(token)));
    nameConditions.push(ilike(productMaster.spec, likePattern(token)));
  }

  const conditions: (SQL | undefined)[] = [
    ne(productMaster.reviewStatus, "MERGED"),
    or(...nameConditions),
  ];
  if (base.productId) conditions.push(ne(productMaster.productId, base.productId));

  const rows = await db
    .select({
      productId: productMaster.productId,
      productName: productMaster.productName,
      productMaker: productMaster.productMaker,
      spec: productMaster.spec,
      category: productMaster.category,
      reviewStatus: productMaster.reviewStatus,
      lastUpdatedAt: productMaster.lastUpdatedAt,
    })
    .from(productMaster)
    .where(and(...conditions))
    .orderBy(desc(productMaster.lastUpdatedAt), productMaster.productId)
    .limit(PREFILTER_LIMIT);

  return rows
    .map((row) => {
      const comparison = compareProducts(base, {
        productName: row.productName,
        productMaker: row.productMaker ?? null,
        spec: row.spec ?? null,
      });
      const reviewStatus = toReviewStatus(row.reviewStatus);
      return {
        comparison,
        candidate: {
          productId: row.productId,
          productName: row.productName,
          productMaker: row.productMaker ?? null,
          spec: row.spec ?? null,
          category: row.category ?? null,
          reviewStatus,
          lastUpdatedAt: row.lastUpdatedAt.toISOString(),
          matchedFields: comparison.matchedFields,
          differingFields: comparison.differingFields,
          mergeable: isMergeTargetStatus(reviewStatus),
        } satisfies SimilarProductCandidate,
      };
    })
    .filter((entry) => entry.comparison.isCandidate)
    .sort((a, b) => b.comparison.score - a.comparison.score)
    .slice(0, limit)
    .map((entry) => entry.candidate);
}

/** 照合時点の候補を product_document_sources.match_candidates に保存する形へ変換する。 */
export function toMatchCandidateSnapshot(
  candidates: SimilarProductCandidate[],
): ProductMatchCandidate[] {
  return candidates.map((candidate) => ({
    productId: candidate.productId,
    productName: candidate.productName,
    spec: candidate.spec,
    matchedFields: candidate.matchedFields,
    differingFields: candidate.differingFields,
    reason: null,
  }));
}

/** 商品IDから現在の類似候補を取得する（確認画面用）。 */
export async function findSimilarProductsFor<H extends PgQueryResultHKT>(
  db: AppDb<H>,
  productId: string,
  limit = DEFAULT_LIMIT,
): Promise<SimilarProductCandidate[]> {
  const [product] = await db
    .select({
      productName: productMaster.productName,
      productMaker: productMaster.productMaker,
      spec: productMaster.spec,
    })
    .from(productMaster)
    .where(eq(productMaster.productId, productId))
    .limit(1);
  if (!product) return [];
  return findSimilarProducts(
    db,
    {
      productId,
      productName: product.productName,
      productMaker: product.productMaker ?? null,
      spec: product.spec ?? null,
    },
    limit,
  );
}
