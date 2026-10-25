import { isDeepStrictEqual } from 'node:util';
import { emptyReplayProjection, type ReplayProjection } from './replayData';

function own<T>(map: Record<string, T> | undefined, key: string): T | undefined {
  return map && Object.hasOwn(map, key) ? map[key] : undefined;
}
function put<T>(map: Record<string, T>, key: string, value: T): void {
  if (Object.hasOwn(map, key) && !isDeepStrictEqual(map[key], value))
    throw new Error('Ambiguous original merge identity correspondence requires manual resolution');
  map[key] = value;
}
function scopeIn(scope: string, projection: ReplayProjection): string {
  return scope.replace(/^boards\/([^/]+)(?:\/stories\/([^/]+))?/, (_all, board: string, story?: string) => {
    const id = own(projection.boards, board)?.id ?? board;
    return story ? `boards/${id}/stories/${own(projection.stories, story) ?? story}` : `boards/${id}`;
  });
}
/** Invert the two original-parent maps into the committed merge's namespace, without guessing IDs. */
export function mergeReplayProjection(
  parents: readonly { before: ReplayProjection; after: ReplayProjection }[],
): ReplayProjection {
  const result = emptyReplayProjection();
  for (const { before, after } of parents) {
    for (const [raw, old] of Object.entries(before.boards)) {
      const next = own(after.boards, raw);
      if (next) put(result.boards, old.id, next);
    }
    for (const [raw, old] of Object.entries(before.stories)) {
      const next = own(after.stories, raw);
      if (next) put(result.stories, old, next);
    }
    for (const scope of new Set([...Object.keys(before.fields), ...Object.keys(after.fields)])) {
      const a = own(before.fields, scope) ?? {},
        b = own(after.fields, scope) ?? {};
      const target = scopeIn(scope, before);
      result.fields[target] ??= Object.create(null);
      const map = result.fields[target];
      if (!map) throw new Error('Missing original merge field scope');
      for (const raw of new Set([...Object.keys(a), ...Object.keys(b)]))
        put(map, own(a, raw) ?? raw, own(b, raw) ?? raw);
    }
    for (const owner of new Set([...Object.keys(before.owners), ...Object.keys(after.owners)])) {
      const a = own(before.owners, owner) ?? {},
        b = own(after.owners, owner) ?? {};
      result.owners[owner] ??= Object.create(null);
      const scopes = result.owners[owner];
      if (!scopes) throw new Error('Missing original merge Plugin map');
      for (const scope of new Set([...Object.keys(a), ...Object.keys(b)])) {
        const old = own(a, scope) ?? {},
          next = own(b, scope) ?? {};
        const target = scopeIn(scope, before);
        scopes[target] ??= Object.create(null);
        const map = scopes[target];
        if (!map) throw new Error('Missing original merge Plugin scope');
        for (const raw of new Set([...Object.keys(old), ...Object.keys(next)]))
          put(map, own(old, raw) ?? raw, own(next, raw) ?? raw);
      }
    }
  }
  return result;
}
