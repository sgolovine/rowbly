import { createHash } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';

/** Missing is undefined, distinct from a stored JSON null. Files carry byte-exact base64. */
export interface MergeFile {
  data: string;
  mode: '100644' | '100755';
}
export type MergeFiles = Record<string, MergeFile>;
export interface IdentityRemap {
  source: string;
  boards: Record<string, string>;
  stories: Record<string, string>;
}
export interface RequiredStory {
  source: string;
  key: string;
}
export interface PluginMergeSnapshot {
  /** Core scope paths: empty for the Data Root, boards/<id>, or boards/<id>/stories/<key>. */
  bags: Record<string, unknown>;
  /** Paths relative to the Data Root, restricted to this Plugin's scoped folders. */
  files: MergeFiles;
}
export interface MergeDecision {
  path: string;
  reason: string;
  base: unknown;
  alternatives: unknown[];
  chosen: unknown;
}
export interface MergeHelpers {
  same(left: unknown, right: unknown): boolean;
  read(file: MergeFile): string;
  file(text: string, mode?: MergeFile['mode']): MergeFile;
  value(base: unknown, left: unknown, right: unknown, path: string): unknown;
  text(base: string, left: string, right: string, path: string): string;
  members(base: readonly unknown[], left: readonly unknown[], right: readonly unknown[]): unknown[];
  retain(path: string, reason: string, base: unknown, left: unknown, right: unknown, chosen: unknown): void;
}
export interface PluginReconciliation {
  base: PluginMergeSnapshot;
  left: PluginMergeSnapshot;
  right: PluginMergeSnapshot;
  remaps: readonly [IdentityRemap, IdentityRemap];
  helpers: MergeHelpers;
  /** Final retained core identities; no other Plugin data is exposed. */
  stories: readonly string[];
}
/** Pure supported-format reconciliation only. Return no entry to keep the host's opaque merge. */
export type PluginReconciler = (
  input: PluginReconciliation,
) => PluginMergeSnapshot & { requiredStories?: readonly RequiredStory[] };

export function canonicalValue(value: unknown): string {
  if (value === undefined) return 'undefined';
  if (Array.isArray(value)) return `[${value.map(canonicalValue).join(',')}]`;
  if (isObject(value))
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonicalValue(value[key])}`)
      .join(',')}}`;
  return JSON.stringify(value);
}
export function mergeDigest(value: unknown): string {
  return createHash('sha256').update(canonicalValue(value)).digest('hex');
}
export function isObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}
function ordered(values: readonly unknown[]): unknown[] {
  return [...new Map(values.map((v) => [canonicalValue(v), v])).entries()]
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([, v]) => v);
}

/** Helpers retain complete conflict alternatives before selecting any deterministic active value. */
export function createMergeHelpers(decisions: MergeDecision[]): MergeHelpers {
  const helpers: MergeHelpers = {
    same: isDeepStrictEqual,
    read(file) {
      const bytes = Buffer.from(file.data, 'base64');
      const text = bytes.toString('utf8');
      if (!Buffer.from(text).equals(bytes)) throw new Error('Supported Plugin text is not UTF-8');
      return text;
    },
    file: (text, mode = '100644') => ({ data: Buffer.from(text).toString('base64'), mode }),
    retain(path, reason, base, left, right, chosen) {
      const present = (v: unknown) => (v === undefined ? { missing: true } : { value: v });
      decisions.push({
        path,
        reason,
        base: present(base),
        alternatives: ordered([present(left), present(right)]),
        chosen: present(chosen),
      });
    },
    value(base, left, right, path) {
      if (isDeepStrictEqual(left, right)) return structuredClone(left);
      if (isDeepStrictEqual(base, left)) return structuredClone(right);
      if (isDeepStrictEqual(base, right)) return structuredClone(left);
      // A concurrent edit survives deletion, with deletion intent recorded.
      if (left === undefined || right === undefined) {
        const chosen = left === undefined ? right : left;
        helpers.retain(path, 'edit retained against deletion', base, left, right, chosen);
        return structuredClone(chosen);
      }
      if (isObject(left) && isObject(right) && (base === undefined || isObject(base))) {
        const out: Record<string, unknown> = {};
        const old = isObject(base) ? base : {};
        for (const key of [...new Set([...Object.keys(old), ...Object.keys(left), ...Object.keys(right)])].sort()) {
          const value = helpers.value(old[key], left[key], right[key], `${path}/${key}`);
          if (value !== undefined) out[key] = value;
        }
        return out;
      }
      const chosen = ordered([left, right])[0];
      helpers.retain(path, 'concurrent scalar, type or opaque value', base, left, right, chosen);
      return structuredClone(chosen);
    },
    members(base, left, right) {
      return ordered([...base, ...left, ...right]).filter((value) => {
        const has = (a: readonly unknown[]) => a.some((v) => isDeepStrictEqual(v, value));
        return has(base) ? has(left) && has(right) : has(left) || has(right);
      });
    },
    text(base, left, right, path) {
      if (left === right) return left;
      if (left === base) return right;
      if (right === base) return left;
      const old = lines(base);
      const edits = [
        ...lineEdits(old, lines(left)).map((e) => ({ ...e, side: 0 })),
        ...lineEdits(old, lines(right)).map((e) => ({ ...e, side: 1 })),
      ].sort((a, b) => a.start - b.start || a.end - b.end || a.side - b.side);
      const result: string[] = [];
      let cursor = 0;
      for (let n = 0; n < edits.length; ) {
        const first = edits[n];
        if (!first) break;
        const group = [first];
        let end = first.end;
        let k = n + 1;
        while (k < edits.length) {
          const next = edits[k];
          if (
            !next ||
            !(
              next.start < end ||
              next.start === first.start ||
              (next.start === end && next.start === next.end && group.some((e) => e.start === e.end && e.start === end))
            )
          )
            break;
          group.push(next);
          end = Math.max(end, next.end);
          k++;
        }
        result.push(...old.slice(cursor, first.start));
        const render = (side: number) => {
          const out: string[] = [];
          let pos = first.start;
          for (const edit of group.filter((e) => e.side === side)) {
            out.push(...old.slice(pos, edit.start), ...edit.text);
            pos = edit.end;
          }
          return [...out, ...old.slice(pos, end)].join('');
        };
        const a = render(0),
          b = render(1),
          before = old.slice(first.start, end).join('');
        let value: string;
        if (!group.some((e) => e.side === 0)) value = b;
        else if (!group.some((e) => e.side === 1)) value = a;
        else if (a === b) value = a;
        else {
          value = a < b ? a : b;
          helpers.retain(`${path}/lines:${first.start}-${end}`, 'overlapping text hunks', before, a, b, value);
        }
        result.push(value);
        cursor = end;
        n = k;
      }
      return [...result, ...old.slice(cursor)].join('');
    },
  };
  return helpers;
}
function lines(text: string): string[] {
  return text.match(/[^\n]*\n|[^\n]+$/g) ?? [];
}
interface LineEdit {
  start: number;
  end: number;
  text: string[];
}
/** LCS hunks, bounded so an oversized document stops preparation instead of losing disjoint edits. */
function lineEdits(base: string[], next: string[]): LineEdit[] {
  if ((base.length + 1) * (next.length + 1) > 2_000_000)
    throw new Error('Text reconciliation exceeds the bounded line comparison size');
  const width = next.length + 1;
  const table = new Uint32Array((base.length + 1) * width);
  for (let i = base.length - 1; i >= 0; i--)
    for (let j = next.length - 1; j >= 0; j--)
      table[i * width + j] =
        base[i] === next[j]
          ? 1 + (table[(i + 1) * width + j + 1] ?? 0)
          : Math.max(table[(i + 1) * width + j] ?? 0, table[i * width + j + 1] ?? 0);
  const edits: LineEdit[] = [];
  let i = 0,
    j = 0,
    edit: LineEdit | undefined;
  while (i < base.length || j < next.length) {
    if (i < base.length && j < next.length && base[i] === next[j]) {
      if (edit) edits.push(edit);
      edit = undefined;
      i++;
      j++;
    } else {
      edit ??= { start: i, end: i, text: [] };
      if (j < next.length && (i === base.length || (table[i * width + j + 1] ?? 0) > (table[(i + 1) * width + j] ?? 0)))
        edit.text.push(next[j++] ?? '');
      else edit.end = ++i;
    }
  }
  if (edit) edits.push(edit);
  return edits.flatMap((edit) =>
    edit.end - edit.start === edit.text.length
      ? edit.text.map((text, offset) => ({ start: edit.start + offset, end: edit.start + offset + 1, text: [text] }))
      : [edit],
  );
}
