/** Exact and contiguous matches lead; otherwise prefer a compact, early subsequence. */
function matchScore(text: string, query: string): number {
  if (text === query) {
    return 0;
  }
  const contiguous = text.indexOf(query);
  if (contiguous >= 0) {
    return 1 + contiguous / (text.length + 1);
  }
  let position = -1;
  let first = 0;
  for (const [index, char] of [...query].entries()) {
    position = text.indexOf(char, position + 1);
    if (position < 0) {
      return Number.POSITIVE_INFINITY;
    }
    if (index === 0) {
      first = position;
    }
  }
  return 2 + (position - first + 1 - query.length) / Math.max(query.length, 1) + first / (text.length + 1);
}

/** Rank separate searchable fields without matching across unrelated fields. Empty queries keep input order. */
export function fuzzySearch<T>(
  entries: readonly T[],
  query: string,
  fields: (entry: T) => readonly string[],
  compare: (a: T, b: T) => number,
): T[] {
  const terms = query.toLowerCase().trim().split(/\s+/).filter(Boolean);
  if (!terms.length) {
    return [...entries];
  }
  return entries
    .map((entry) => {
      const text = fields(entry).map((field) => field.toLowerCase());
      return {
        entry,
        score: terms.reduce((total, term) => total + Math.min(...text.map((field) => matchScore(field, term))), 0),
      };
    })
    .filter(({ score }) => Number.isFinite(score))
    .sort((a, b) => a.score - b.score || compare(a.entry, b.entry))
    .map(({ entry }) => entry);
}
