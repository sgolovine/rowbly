import { BoardConfigSchema, StorySchema } from '../../schemas';
import { type DataMergeResult, evidenceSource, type MergeSource, mergeData } from './mergeData';
import {
  type IdentityRemap,
  type MergeFile,
  type MergeFiles,
  mergeDigest,
  type PluginIdentityMap,
} from './reconciliation';
import type { AnyPluginDefinition } from './types';

export interface ReplayProjection {
  boards: Record<string, { id: string; keyPrefix: string }>;
  stories: Record<string, string>;
  owners: Record<string, PluginIdentityMap>;
}
export function emptyReplayProjection(): ReplayProjection {
  return { boards: Object.create(null), stories: Object.create(null), owners: Object.create(null) };
}
function own<T>(values: Readonly<Record<string, T>> | undefined, key: string): T | undefined {
  return values && Object.hasOwn(values, key) ? values[key] : undefined;
}
const BOARD = /^boards\/([^/]+)\/board.config.json$/;
const STORY = /^boards\/([^/]+)\/stories\/([^/]+)\/story.json$/;
function json(file: MergeFile): Record<string, unknown> {
  return JSON.parse(Buffer.from(file.data, 'base64').toString('utf8'));
}
function encode(value: unknown): MergeFile {
  return { data: Buffer.from(`${JSON.stringify(value, null, 2)}\n`).toString('base64'), mode: '100644' };
}
function allocatedSlug(id: string, used: Set<string>): string {
  for (let n = 2; n < 100_000; n++) {
    const next = `${id.slice(0, 50)}-${n}`;
    if (!used.has(next)) {
      used.add(next);
      return next;
    }
  }
  throw new Error('No unused Board identity for replay');
}
/** Simultaneous core path transport. New identities cannot overwrite earlier transport destinations. */
export function projectReplayCore(
  original: MergeSource,
  prior: ReplayProjection,
): {
  source: MergeSource;
  projection: ReplayProjection;
  scope(scope: string): string;
} {
  const projection = emptyReplayProjection();
  const boards = Object.entries(original.files)
    .filter(([path]) => BOARD.test(path))
    .map(([, file]) => BoardConfigSchema.parse(json(file)));
  const usedIds = new Set([
    ...boards.map((board) => board.id),
    ...Object.values(prior.boards).map((board) => board.id),
  ]);
  const usedPrefixes = new Set([
    ...boards.map((board) => board.keyPrefix),
    ...Object.values(prior.boards).map((board) => board.keyPrefix),
  ]);
  const occupiedIds = new Set<string>(),
    occupiedPrefixes = new Set<string>();
  for (const board of [...boards].sort(
    (a, b) =>
      Number(Boolean(own(prior.boards, b.id))) - Number(Boolean(own(prior.boards, a.id))) ||
      (a.id < b.id ? -1 : a.id > b.id ? 1 : 0),
  )) {
    let target = own(prior.boards, board.id) ?? { id: board.id, keyPrefix: board.keyPrefix };
    if (occupiedIds.has(target.id) || occupiedPrefixes.has(target.keyPrefix)) {
      if (own(prior.boards, board.id)) throw new Error('Ambiguous Board replay identity correspondence');
      const id = allocatedSlug(board.id, usedIds);
      let keyPrefix = '';
      for (let n = 2; n < 1_000_000; n++) {
        const candidate = `${board.keyPrefix.slice(0, 5)}${n}`;
        if (!usedPrefixes.has(candidate)) {
          keyPrefix = candidate;
          usedPrefixes.add(candidate);
          break;
        }
      }
      if (!keyPrefix) throw new Error('No unused Board key prefix for replay');
      target = { id, keyPrefix };
    }
    occupiedIds.add(target.id);
    occupiedPrefixes.add(target.keyPrefix);
    projection.boards[board.id] = target;
  }
  const stories = Object.entries(original.files)
    .filter(([path]) => STORY.test(path))
    .map(([, file]) => StorySchema.parse(json(file)));
  const usedKeys = new Set([...stories.map((story) => story.key), ...Object.values(prior.stories)]),
    occupiedKeys = new Set<string>();
  for (const story of [...stories].sort(
    (a, b) =>
      Number(Boolean(own(prior.stories, b.key))) - Number(Boolean(own(prior.stories, a.key))) ||
      (a.key < b.key ? -1 : a.key > b.key ? 1 : 0),
  )) {
    const board = projection.boards[story.boardId];
    if (!board) throw new Error('Missing replay source Board');
    let key = own(prior.stories, story.key) ?? `${board.keyPrefix}-${story.key.slice(story.key.lastIndexOf('-') + 1)}`;
    if (occupiedKeys.has(key)) {
      if (own(prior.stories, story.key)) throw new Error('Ambiguous Story replay identity correspondence');
      let number =
        Math.max(
          0,
          ...[...usedKeys]
            .filter((value) => value.startsWith(`${board.keyPrefix}-`))
            .map((value) => Number(value.slice(board.keyPrefix.length + 1))),
        ) + 1;
      while (usedKeys.has(`${board.keyPrefix}-${number}`)) number++;
      key = `${board.keyPrefix}-${number}`;
      usedKeys.add(key);
    }
    occupiedKeys.add(key);
    projection.stories[story.key] = key;
  }
  const scope = (path: string): string =>
    path.replace(/^boards\/([^/]+)(?:\/stories\/([^/]+))?/, (_all, board: string, story?: string) => {
      const id = projection.boards[board]?.id ?? board;
      return story ? `boards/${id}/stories/${projection.stories[story] ?? story}` : `boards/${id}`;
    });
  const files: MergeFiles = {};
  for (const [path, raw] of Object.entries(original.files)) {
    const target = scope(path);
    if (files[target]) throw new Error(`Replay path collision at ${target}`);
    if (BOARD.test(path)) {
      const value = json(raw),
        board = projection.boards[String(value.id)];
      files[target] =
        board && (value.id !== board.id || value.keyPrefix !== board.keyPrefix)
          ? encode({ ...value, id: board.id, keyPrefix: board.keyPrefix })
          : raw;
    } else if (STORY.test(path)) {
      const value = json(raw),
        board = projection.boards[String(value.boardId)],
        key = projection.stories[String(value.key)];
      files[target] =
        board && key && (value.boardId !== board.id || value.key !== key)
          ? encode({ ...value, key, boardId: board.id })
          : raw;
    } else files[target] = raw;
  }
  const remap: IdentityRemap = {
    source: original.id,
    boards: Object.fromEntries(
      Object.entries(projection.boards)
        .filter(([id, board]) => id !== board.id)
        .map(([id, board]) => [id, board.id]),
    ),
    stories: Object.fromEntries(Object.entries(projection.stories).filter(([from, to]) => from !== to)),
  };
  return { source: { id: original.id, files, projection: remap }, projection, scope };
}

/** Reuse the one pure owner callback to transport each complete immutable source before replay. */
export function transportReplayData(
  original: MergeSource,
  prior: ReplayProjection,
  registry: readonly AnyPluginDefinition[],
): {
  source: MergeSource;
  projection: ReplayProjection;
  evidence: string[];
  core: MergeSource;
} {
  // Recognized raw duplicate identities must fail before projection, including beside future formats.
  mergeData(original, original, original, registry);
  const core = projectReplayCore(original, prior);
  const owners: Record<string, PluginIdentityMap> = {};
  for (const [owner, scopes] of Object.entries(prior.owners))
    owners[owner] = Object.fromEntries(Object.entries(scopes).map(([scope, map]) => [core.scope(scope), map]));
  const result = mergeData(core.source, core.source, core.source, registry, { [original.id]: owners });
  for (const identity of result.identities ?? []) {
    const rawScope =
      Object.keys(own(prior.owners, identity.owner) ?? {}).find((scope) => core.scope(scope) === identity.scope) ??
      identity.scope;
    core.projection.owners[identity.owner] ??= Object.create(null);
    const maps = core.projection.owners[identity.owner];
    if (!maps) throw new Error('Missing replay Plugin map');
    maps[rawScope] ??= Object.create(null);
    const map = maps[rawScope];
    if (!map) throw new Error('Missing replay scope map');
    map[identity.from] = identity.to;
  }
  return {
    source: { id: original.id, files: result.files },
    projection: core.projection,
    evidence: result.evidence,
    core: core.source,
  };
}

/** Compose correspondence in one source's namespace, preserving permutations and new allocations. */
export function replayProjectionFor(
  original: MergeSource,
  transported: ReplayProjection,
  result: DataMergeResult,
): ReplayProjection {
  const next = emptyReplayProjection();
  const map = result.remaps.find((value) => value.source === original.id);
  if (!map) throw new Error('Missing replay source correspondence');
  for (const [from, target] of Object.entries(transported.boards)) {
    const id = own(map.boards, target.id) ?? target.id;
    const file = result.files[`boards/${id}/board.config.json`];
    if (!file) continue;
    next.boards[from] = { id, keyPrefix: BoardConfigSchema.parse(json(file)).keyPrefix };
  }
  for (const [from, target] of Object.entries(transported.stories))
    next.stories[from] = own(map.stories, target) ?? target;
  for (const owner of new Set([
    ...Object.keys(transported.owners),
    ...(result.identities ?? []).map((value) => value.owner),
  ])) {
    const output = (result.identities ?? []).filter((value) => value.owner === owner && value.source === original.id);
    const originalScope = (scope: string) =>
      scope.replace(/^boards\/([^/]+)(?:\/stories\/([^/]+))?/, (_all, board: string, story?: string) => {
        const id = Object.entries(next.boards).find(([, target]) => target.id === board)?.[0] ?? board;
        const key = story
          ? (Object.entries(next.stories).find(([, target]) => target === story)?.[0] ?? story)
          : undefined;
        return key ? `boards/${id}/stories/${key}` : `boards/${id}`;
      });
    const rawScopes = new Set([
      ...Object.keys(own(transported.owners, owner) ?? {}),
      ...output.map((value) => originalScope(value.scope)),
    ]);
    for (const scope of rawScopes) {
      const before = own(own(transported.owners, owner), scope) ?? {};
      const finalScope = scope.replace(
        /^boards\/([^/]+)(?:\/stories\/([^/]+))?/,
        (_all, board: string, story?: string) => {
          const id = next.boards[board]?.id ?? board;
          return story ? `boards/${id}/stories/${next.stories[story] ?? story}` : `boards/${id}`;
        },
      );
      const changes = Object.fromEntries(
        output.filter((value) => value.scope === finalScope).map((value) => [value.from, value.to]),
      );
      const origins = new Set([
        ...Object.keys(before),
        ...Object.keys(changes).filter((id) => !Object.values(before).includes(id)),
      ]);
      const composed: Record<string, string> = Object.create(null);
      for (const from of origins) {
        const priorId = own(before, from) ?? from;
        const to = own(changes, priorId) ?? priorId;
        if (from !== to) composed[from] = to;
      }
      if (Object.keys(composed).length) {
        const scopes: PluginIdentityMap = own(next.owners, owner) ?? Object.create(null);
        scopes[scope] = composed;
        next.owners[owner] = scopes;
      }
    }
  }
  return next;
}

/** Every actual replay retains raw and projected P/R/C, even when transport creates no conflict. */
export function retainReplayProvenance(
  result: DataMergeResult,
  original: { base: MergeSource; current: MergeSource; commit: MergeSource },
  projected: { base: MergeSource; current: MergeSource; commit: MergeSource },
  projection: ReplayProjection,
  mergeOverlay?: { parents: readonly string[]; baseline: MergeSource; committed: MergeSource },
): string {
  const record = {
    version: 1,
    kind: 'replay',
    original: {
      base: evidenceSource(original.base),
      current: evidenceSource(original.current),
      commit: evidenceSource(original.commit),
    },
    projected: {
      base: evidenceSource(projected.base),
      current: evidenceSource(projected.current),
      commit: evidenceSource(projected.commit),
    },
    projection,
    ...(mergeOverlay
      ? {
          mergeOverlay: {
            parents: mergeOverlay.parents,
            baseline: evidenceSource(mergeOverlay.baseline),
            committed: evidenceSource(mergeOverlay.committed),
          },
        }
      : {}),
    output: evidenceSource({ id: 'prepared-replay-tree', files: result.files }),
  };
  const path = `plugins/git/merge-evidence/${mergeDigest(record)}.json`;
  result.files[path] = encode(record);
  result.evidence.push(path);
  return path;
}
