/** Where a subsequence match starts and where its last character is. */
interface Subsequence {
  readonly first: number;
  readonly position: number;
}

/** The next character of the query after the match so far; null when the text has no such character. */
function nextChar(text: string, match: Subsequence | null, char: string, index: number): Subsequence | null {
  const position = match ? text.indexOf(char, match.position + 1) : -1;

  if (!match || position < 0) {
    return null;
  }

  return { first: index === 0 ? position : match.first, position };
}

/** Exact and contiguous matches lead; otherwise prefer a compact, early subsequence. */
function matchScore(text: string, query: string): number {
  const contiguous = text.indexOf(query);
  const start: Subsequence | null = { first: 0, position: -1 };

  if (text === query) {
    return 0;
  }

  if (contiguous >= 0) {
    return 1 + contiguous / (text.length + 1);
  }

  const match = [...query].reduce<Subsequence | null>(
    (found, char, index) => nextChar(text, found, char, index),
    start,
  );

  if (!match) {
    return Number.POSITIVE_INFINITY;
  }

  const { first, position } = match;

  return 2 + (position - first + 1 - query.length) / Math.max(query.length, 1) + first / (text.length + 1);
}

function entryScore(texts: readonly string[], terms: readonly string[]): number {
  return terms.reduce((total, term) => total + Math.min(...texts.map((field) => matchScore(field, term))), 0);
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
    .map((entry) => ({
      entry,
      score: entryScore(
        fields(entry).map((field) => field.toLowerCase()),
        terms,
      ),
    }))
    .filter(({ score }) => Number.isFinite(score))
    .toSorted((a, b) => a.score - b.score || compare(a.entry, b.entry))
    .map(({ entry }) => entry);
}
