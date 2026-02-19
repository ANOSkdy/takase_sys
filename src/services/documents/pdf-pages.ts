function extractPageTreeCounts(pdfText: string): number[] {
  const counts: number[] = [];
  const objectRegex = /\d+\s+\d+\s+obj([\s\S]*?)endobj/g;

  for (const match of pdfText.matchAll(objectRegex)) {
    const body = match[1] ?? "";
    if (!/\/Type\s*\/Pages\b/.test(body)) continue;

    const countMatch = body.match(/\/Count\s+(\d{1,5})\b/);
    if (!countMatch) continue;

    const count = Number(countMatch[1]);
    if (Number.isFinite(count) && count > 0) counts.push(count);
  }

  return counts;
}

export function detectPdfPageCount(pdfBuffer: Buffer): number {
  const text = pdfBuffer.toString("latin1");

  const pageTreeCounts = extractPageTreeCounts(text);
  if (pageTreeCounts.length > 0) {
    return Math.max(...pageTreeCounts);
  }

  const fallbackCounts = [...text.matchAll(/\/Count\s+(\d{1,5})\b/g)]
    .map((m) => Number(m[1]))
    .filter((count) => Number.isFinite(count) && count > 0);

  return fallbackCounts.length > 0 ? Math.max(...fallbackCounts) : 1;
}
