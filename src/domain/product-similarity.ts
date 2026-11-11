import { normalizeText } from "@/domain/normalize";

/**
 * 類似候補の比較。候補はあくまで人が確認するための提示であり、
 * ここでの一致をもって自動統合はしない。正答率のような数値も出さない
 * （score は並べ替えと足切りのための内部値）。
 */

export type ComparableProduct = {
  productName: string;
  productMaker: string | null;
  spec: string | null;
};

export type ProductComparison = {
  /** 一致した項目（表示用の文言）。 */
  matchedFields: string[];
  /** 相違した項目（表示用の文言。値の違いを含む）。 */
  differingFields: string[];
  score: number;
  /** 候補として提示する最低条件を満たすか。 */
  isCandidate: boolean;
};

const SIZE_UNITS = "φ|Φ|ø|mm|cm|m|A|B|kg|g|L|l|ml|インチ|吋|角|本|個|枚|巻|W|V";
const SIZE_PATTERN = new RegExp(
  `(?:(φ|Φ|ø)\\s*(\\d+(?:\\.\\d+)?))|(?:(\\d+(?:\\.\\d+)?)\\s*(${SIZE_UNITS})(?![A-Za-z0-9]))`,
  "g",
);
// 英字と数字の両方を含む連続トークン（例: WTP150, SFJ-77-W, C-NG5）。
const MODEL_PATTERN = /[A-Za-z0-9][A-Za-z0-9-]*[A-Za-z0-9]/g;

function normalizeForCompare(value: string | null | undefined): string {
  return value ? normalizeText(value).toLowerCase() : "";
}

function normalizeUnit(unit: string): string {
  if (unit === "Φ" || unit === "ø") return "φ";
  if (unit === "吋") return "インチ";
  if (unit === "l") return "L";
  return unit;
}

/** 型番らしいトークン（英字と数字を両方含むもの）を取り出す。 */
export function extractModelTokens(text: string | null | undefined): string[] {
  if (!text) return [];
  const normalized = normalizeText(text).toUpperCase();
  const tokens = new Set<string>();
  for (const match of normalized.matchAll(MODEL_PATTERN)) {
    const token = match[0];
    // 「255MM」「20A」のような数値＋単位は寸法として扱い、型番には含めない。
    if (/^\d+(?:\.\d+)?[A-Z]+$/.test(token)) continue;
    if (/[A-Z]/.test(token) && /\d/.test(token) && token.length >= 3) tokens.add(token);
  }
  return Array.from(tokens);
}

/** 口径・寸法・数量単位つきの数値（例: 150φ, □255mm → 255mm, 20A）を取り出す。 */
export function extractSizeTokens(text: string | null | undefined): string[] {
  if (!text) return [];
  const normalized = normalizeText(text);
  const tokens = new Set<string>();
  for (const match of normalized.matchAll(SIZE_PATTERN)) {
    if (match[1] && match[2]) {
      // 記号が前に付く形（φ150）。
      tokens.add(`${Number(match[2])}φ`);
    } else if (match[3] && match[4]) {
      tokens.add(`${Number(match[3])}${normalizeUnit(match[4])}`);
    }
  }
  return Array.from(tokens).sort();
}

function bigrams(text: string): Set<string> {
  const compact = text.replace(/\s+/g, "");
  const grams = new Set<string>();
  if (compact.length < 2) {
    if (compact) grams.add(compact);
    return grams;
  }
  for (let i = 0; i < compact.length - 1; i += 1) grams.add(compact.slice(i, i + 2));
  return grams;
}

/** 文字2-gram の Dice 係数（0〜1）。 */
export function nameSimilarity(a: string, b: string): number {
  const left = bigrams(normalizeForCompare(a));
  const right = bigrams(normalizeForCompare(b));
  if (left.size === 0 || right.size === 0) return 0;
  let shared = 0;
  for (const gram of left) if (right.has(gram)) shared += 1;
  return (2 * shared) / (left.size + right.size);
}

function sameSet(a: string[], b: string[]): boolean {
  return a.length === b.length && a.every((value) => b.includes(value));
}

const NAME_PARTIAL_MIN = 0.6;
const CANDIDATE_MIN_SCORE = 2;

export function compareProducts(
  base: ComparableProduct,
  other: ComparableProduct,
): ProductComparison {
  const matchedFields: string[] = [];
  const differingFields: string[] = [];
  let score = 0;

  // 品名
  const baseName = normalizeForCompare(base.productName);
  const otherName = normalizeForCompare(other.productName);
  const similarity = nameSimilarity(base.productName, other.productName);
  let nameRelated = false;
  if (baseName && baseName === otherName) {
    matchedFields.push("品名");
    score += 3;
    nameRelated = true;
  } else if (
    baseName &&
    otherName &&
    (baseName.includes(otherName) || otherName.includes(baseName) || similarity >= NAME_PARTIAL_MIN)
  ) {
    matchedFields.push("品名（部分一致）");
    score += 1.5;
    nameRelated = true;
  } else {
    differingFields.push("品名");
  }

  // メーカー（片方が空なら判断材料にしない）
  const baseMaker = normalizeForCompare(base.productMaker);
  const otherMaker = normalizeForCompare(other.productMaker);
  if (baseMaker && otherMaker) {
    if (baseMaker === otherMaker) {
      matchedFields.push("メーカー");
      score += 1;
    } else {
      differingFields.push("メーカー");
      score -= 0.5;
    }
  }

  // 型番
  const baseModels = extractModelTokens(`${base.productName} ${base.spec ?? ""}`);
  const otherModels = extractModelTokens(`${other.productName} ${other.spec ?? ""}`);
  let modelMatched = false;
  if (baseModels.length && otherModels.length) {
    if (baseModels.some((token) => otherModels.includes(token))) {
      matchedFields.push("型番");
      score += 3;
      modelMatched = true;
    } else {
      differingFields.push(`型番（${baseModels.join(" ")} ／ ${otherModels.join(" ")}）`);
      score -= 1;
    }
  }

  // 口径・寸法・単位。同名でもここが違えば別商品の可能性が高いので必ず相違として示す。
  const baseSizes = extractSizeTokens(`${base.productName} ${base.spec ?? ""}`);
  const otherSizes = extractSizeTokens(`${other.productName} ${other.spec ?? ""}`);
  if (baseSizes.length && otherSizes.length) {
    if (sameSet(baseSizes, otherSizes)) {
      matchedFields.push("口径・寸法");
      score += 1;
    } else {
      differingFields.push(`口径・寸法（${baseSizes.join(" ")} ／ ${otherSizes.join(" ")}）`);
      score -= 1;
    }
  }

  // 規格（全文）
  const baseSpec = normalizeForCompare(base.spec);
  const otherSpec = normalizeForCompare(other.spec);
  if (baseSpec && otherSpec) {
    if (baseSpec === otherSpec) {
      matchedFields.push("規格");
      score += 2;
    } else {
      differingFields.push("規格");
    }
  } else if (baseSpec !== otherSpec) {
    differingFields.push("規格（片方のみ）");
  }

  return {
    matchedFields,
    differingFields,
    score,
    isCandidate: (nameRelated || modelMatched) && score >= CANDIDATE_MIN_SCORE,
  };
}
