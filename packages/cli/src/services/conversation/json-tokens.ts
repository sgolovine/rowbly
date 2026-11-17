/** The kind of a piece of JSON text, for syntax highlighting. */
export type JsonTokenKind = "key" | "string" | "number" | "literal" | "punctuation" | "plain";

/** One piece of text and its kind. */
export interface JsonToken {
  readonly text: string;
  readonly kind: JsonTokenKind;
}

/**
 * The tokens that have a kind. A string token stops at a line break or at the end of the text, so cut JSON
 * still gets tokens. A string before a `:` is a key. A number or a literal must not touch a word character.
 */
const TOKEN =
  /(?<key>"(?:[^"\\\n]|\\.)*"(?=\s*:))|(?<string>"(?:[^"\\\n]|\\.)*"?)|(?<number>(?<![\w.])-?\d+(?:\.\d*)?(?:[eE][+-]?\d*)?(?![\w.]))|(?<literal>(?<!\w)(?:true|false|null)(?!\w))|(?<punctuation>[{}[\]:,])/g;

const KINDS: readonly JsonTokenKind[] = ["key", "string", "number", "literal", "punctuation"];

function matchKind(match: RegExpMatchArray): JsonTokenKind {
  return KINDS.find((kind) => match.groups?.[kind] !== undefined) ?? "plain";
}

/** The plain text between the end of the previous token and `match`, then the token of `match`. */
function matchTokens(text: string, match: RegExpMatchArray, previous: RegExpMatchArray | undefined): JsonToken[] {
  const start = previous ? (previous.index ?? 0) + previous[0].length : 0;
  const index = match.index ?? 0;
  const gap: JsonToken[] = index > start ? [{ text: text.slice(start, index), kind: "plain" }] : [];

  return [...gap, { text: match[0], kind: matchKind(match) }];
}

/**
 * Splits `text` into JSON tokens without a parse, so cut or invalid JSON also gets tokens. The text of the
 * tokens, in order, is always equal to `text`.
 */
export function jsonTokens(text: string): JsonToken[] {
  const matches = [...text.matchAll(TOKEN)];
  const last = matches.at(-1);
  const end = last ? (last.index ?? 0) + last[0].length : 0;
  const tail: JsonToken[] = end < text.length ? [{ text: text.slice(end), kind: "plain" }] : [];

  return [...matches.flatMap((match, index) => matchTokens(text, match, matches[index - 1])), ...tail];
}

/** One character of a token, with the kind of the token. */
interface KindChar {
  readonly char: string;
  readonly kind: JsonTokenKind;
}

/** Adjacent characters of one kind as one token. */
function joinChars(chars: readonly KindChar[]): JsonToken[] {
  const starts = chars.flatMap((char, index) => (index === 0 || chars[index - 1]?.kind !== char.kind ? [index] : []));

  return starts.map((start, index) => {
    const run = chars.slice(start, starts[index + 1] ?? chars.length);

    return { text: run.map((char) => char.char).join(""), kind: run[0]?.kind ?? "plain" };
  });
}

/** The characters of one line in groups of `width`; no characters give one empty row. */
function lineRows(chars: readonly KindChar[], width: number): JsonToken[][] {
  const count = Math.max(1, Math.ceil(chars.length / width));

  return Array.from({ length: count }, (_, index) => joinChars(chars.slice(index * width, (index + 1) * width)));
}

/** The characters of the tokens, split into lines at each line break. */
function charLines(tokens: readonly JsonToken[]): KindChar[][] {
  const chars = tokens.flatMap((token) => Array.from(token.text, (char) => ({ char, kind: token.kind })));
  const breaks = chars.flatMap((char, index) => (char.char === "\n" ? [index] : []));
  const starts = [0, ...breaks.map((index) => index + 1)];

  return starts.map((start, index) => chars.slice(start, breaks[index] ?? chars.length));
}

/**
 * The tokens of `text` in rows of at most `width` characters, with the line breaks of the text. The rows
 * have the same text as `plainRows`, and a token that wraps keeps its kind on the next row.
 */
export function jsonTokenRows(text: string, width: number): JsonToken[][] {
  const size = Math.max(1, width);

  return charLines(jsonTokens(text)).flatMap((line) => lineRows(line, size));
}
