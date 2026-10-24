import { isDeepStrictEqual } from 'node:util';
import { rankAfter } from '../../core';
import { BoardConfigSchema, type CustomFieldDef, DEFAULT_STAGES, RowblyConfigSchema, StorySchema } from '../../schemas';
import { fieldValueError, validateFieldValues } from '../_customFieldValues';
import {
  canonicalValue,
  createMergeHelpers,
  type IdentityRemap,
  isObject,
  type MergeDecision,
  type MergeFile,
  type MergeFiles,
  type MergeHelpers,
  mergeDigest,
  type PluginMergeSnapshot,
  type RequiredStory,
} from './reconciliation';
import type { AnyPluginDefinition } from './types';

export interface MergeSource {
  id: string;
  files: MergeFiles;
}
export interface DataMergeResult {
  files: MergeFiles;
  remaps: [IdentityRemap, IdentityRemap];
  decisions: MergeDecision[];
  evidence: string[];
}
const BOARD = /^boards\/([^/]+)\/board.config.json$/;
const STORY = /^boards\/([^/]+)\/stories\/([^/]+)\/story.json$/;
const PLUGIN = /^(?:(boards\/[^/]+)(?:\/stories\/[^/]+)?\/)?plugins\/([^/]+)\/(.+)$/;
const CORE = /^(rowbly.config.json|boards\/[^/]+\/board.config.json|boards\/[^/]+\/stories\/[^/]+\/story.json)$/;

/** Explicit owned paths: an arbitrary file under a Data Root is not automatically mergeable. */
export function isRowblyPath(path: string): boolean {
  return CORE.test(path) || path === '.gitignore' || PLUGIN.test(path);
}
function decode(file: MergeFile): string {
  const bytes = Buffer.from(file.data, 'base64');
  const text = bytes.toString('utf8');
  if (!Buffer.from(text).equals(bytes)) throw new Error('Core configuration is not UTF-8');
  return text;
}
function json(file: MergeFile | undefined): Record<string, unknown> | undefined {
  if (!file) return undefined;
  const value: unknown = JSON.parse(decode(file));
  if (!isObject(value)) throw new Error('Expected an object in a Rowbly record');
  return value;
}
function encode(value: unknown): MergeFile {
  return { data: Buffer.from(`${JSON.stringify(value, null, 2)}\n`).toString('base64'), mode: '100644' };
}
function scopeRecord(scope: string): string {
  return scope ? `${scope}/${scope.includes('/stories/') ? 'story.json' : 'board.config.json'}` : 'rowbly.config.json';
}
function subtree(files: MergeFiles, prefix: string): MergeFiles {
  return Object.fromEntries(
    Object.entries(files)
      .filter(([p]) => p.startsWith(`${prefix}/`))
      .map(([p, v]) => [p.slice(prefix.length + 1), v]),
  );
}
function renameTree(files: MergeFiles, from: string, to: string) {
  for (const [path, value] of Object.entries(files))
    if (path.startsWith(`${from}/`)) {
      const target = `${to}${path.slice(from.length)}`;
      if (files[target]) throw new Error(`Identity remap collides at ${target}`);
      files[target] = value;
      delete files[path];
    }
}
function unusedSlug(key: string, used: Set<string>): string {
  for (let n = 2; n < 100_000; n++) {
    const candidate = `${key.slice(0, 50)}-${n}`;
    if (!used.has(candidate)) {
      used.add(candidate);
      return candidate;
    }
  }
  throw new Error('No unused identity for a merge repair');
}

/** Prepare only detached immutable data. Nothing here touches a Data Root or Git. */
export function mergeData(
  base: MergeSource,
  left: MergeSource,
  right: MergeSource,
  registry: readonly AnyPluginDefinition[],
): DataMergeResult {
  const restores = new Map<string, RequiredStory>();
  const supplied = [left, right];
  const maximum = supplied.reduce((n, source) => n + Object.keys(source.files).filter((p) => STORY.test(p)).length, 0);
  for (let pass = 0; pass <= maximum; pass++) {
    const result = mergeOnce(base, left, right, registry, [...restores.values()]);
    let changed = false;
    for (const request of result.requests) {
      const source = supplied.find((s) => s.id === request.source);
      const path =
        source && Object.keys(source.files).find((p) => STORY.test(p) && json(source.files[p])?.key === request.key);
      if (!source || !path) throw new Error('Plugin requiredStories must name an existing supplied source Story');
      const key = canonicalValue(request);
      if (!restores.has(key)) {
        restores.set(key, request);
        changed = true;
      }
    }
    if (!changed) return result;
  }
  throw new Error('Plugin Story restoration did not converge before publication');
}
function mergeOnce(
  baseSource: MergeSource,
  a: MergeSource,
  b: MergeSource,
  registry: readonly AnyPluginDefinition[],
  restores: RequiredStory[],
): DataMergeResult & { requests: RequiredStory[] } {
  // Source ordering is independent of ours/theirs. Equal IDs must actually be equal snapshots.
  const sources = [a, b].sort((x, y) => (canonicalValue([x.id, x.files]) < canonicalValue([y.id, y.files]) ? -1 : 1));
  const leftSource = sources[0]!,
    rightSource = sources[1]!;
  const base = structuredClone(baseSource.files),
    left = structuredClone(leftSource.files),
    right = structuredClone(rightSource.files);
  for (const files of [base, left, right]) validateInput(files);
  const decisions: MergeDecision[] = [],
    helpers = createMergeHelpers(decisions);
  const remaps: [IdentityRemap, IdentityRemap] = [leftSource, rightSource].map((source) => ({
    source: source.id,
    boards: {},
    stories: {},
  })) as [IdentityRemap, IdentityRemap];
  const requests: RequiredStory[] = [];
  for (const request of restores) {
    const source = [leftSource, rightSource].find((s) => s.id === request.source);
    if (!source) throw new Error('Unknown restoration source');
    const path = Object.keys(source.files).find((p) => STORY.test(p) && json(source.files[p])?.key === request.key);
    if (!path) throw new Error('Unknown restoration Story');
    const prefix = path.slice(0, -11),
      board = path.split('/')[1];
    for (const side of [left, right]) {
      if (!side[`boards/${board}/board.config.json`]) {
        for (const [p, file] of Object.entries(source.files))
          if (p.startsWith(`boards/${board}/`) && !side[p]) side[p] = file;
      } else if (!side[path]) {
        for (const [p, file] of Object.entries(source.files))
          if (p.startsWith(`${prefix}/`) && !side[p]) side[p] = file;
      }
    }
    helpers.retain(
      path,
      'restored source Story and required Board for a supported retained reference',
      baseSource.files[path],
      a.files[path],
      b.files[path],
      { source: request.source, key: request.key },
    );
  }
  retainEditedParents(base, left, right, helpers);
  remapBoards(base, left, right, remaps, helpers);
  remapStories(base, left, right, remaps, helpers);
  splitFieldTypes(base, left, right, helpers);
  const files: MergeFiles = {};
  for (const path of [...new Set([...Object.keys(base), ...Object.keys(left), ...Object.keys(right)])].sort()) {
    if (!isRowblyPath(path)) throw new Error(`Unsupported Rowbly path: ${path}`);
    const old = base[path],
      l = left[path],
      r = right[path];
    if (CORE.test(path)) {
      // Parent identity remains when any descendant was edited or added on either retained side.
      const prefix = path.replace(/\/(story.json|board.config.json)$/, '');
      const descendantEdit = (side: MergeFiles) =>
        Object.keys(side).some((p) => p.startsWith(`${prefix}/`) && !isDeepStrictEqual(side[p], base[p]));
      const retainedLeft = !l && r && descendantEdit(right) ? r : l;
      const retainedRight = !r && l && descendantEdit(left) ? l : r;
      if (retainedLeft !== l || retainedRight !== r)
        helpers.retain(path, 'parent retained for edited descendants', old, l, r, l ?? r);
      const result = mergeRecord(json(old), json(retainedLeft), json(retainedRight), path, helpers);
      if (result !== undefined) files[path] = encode(result);
    } else if (path === '.gitignore') {
      const text = helpers.text(old ? decode(old) : '', l ? decode(l) : '', r ? decode(r) : '', path);
      const entries = text.split('\n');
      for (const mandatory of ['local.json', '.lock', '.lock.break', '.txn/'])
        if (!entries.includes(mandatory)) entries.push(mandatory);
      files[path] = helpers.file(`${entries.filter(Boolean).join('\n')}\n`);
    } else {
      if (/^plugins\/git\/merge-evidence\//.test(path) && l && r && !isDeepStrictEqual(l, r))
        throw new Error('Content-addressed merge evidence disagrees at the same path');
      const result = helpers.value(old, l, r, path);
      if (result !== undefined) files[path] = result as MergeFile;
    }
  }
  for (const definition of registry) {
    if (!definition.reconcile) continue;
    const own = (snapshot: MergeFiles): PluginMergeSnapshot => ({
      bags: Object.fromEntries(
        Object.entries(snapshot)
          .filter(([p]) => CORE.test(p) && files[p])
          .flatMap(([p, file]) => {
            const record = json(file)!;
            const bag = isObject(record.plugins) ? record.plugins[definition.id] : undefined;
            return bag === undefined ? [] : [[p === 'rowbly.config.json' ? '' : p.slice(0, p.lastIndexOf('/')), bag]];
          }),
      ),
      files: Object.fromEntries(Object.entries(snapshot).filter(([p]) => PLUGIN.exec(p)?.[2] === definition.id)),
    });
    const input = freeze({
      base: own(base),
      left: own(left),
      right: own(right),
      remaps: structuredClone(remaps),
      helpers,
      stories: Object.keys(files)
        .filter((p) => STORY.test(p))
        .map((p) => String(json(files[p])?.key)),
    });
    const result = definition.reconcile(input);
    if (!result || !isObject(result.bags) || !isObject(result.files))
      throw new Error(`Invalid reconciliation output from ${definition.id}`);
    for (const request of result.requiredStories ?? []) {
      if (!request || typeof request.source !== 'string' || typeof request.key !== 'string')
        throw new Error('Invalid requiredStories request');
      requests.push(request);
    }
    for (const [scope, bag] of Object.entries(result.bags)) {
      const path = scopeRecord(scope),
        file = files[path];
      if (!file || (scope && !/^(boards\/[^/]+)(\/stories\/[^/]+)?$/.test(scope)))
        throw new Error(`Plugin ${definition.id} wrote outside a retained scope`);
      const record = json(file)!;
      const plugins = isObject(record.plugins) ? record.plugins : {};
      const schema = scope.includes('/stories/') ? definition.bags?.story : undefined;
      if (schema) {
        for (const snapshot of [input.base, input.left, input.right]) {
          const raw = snapshot.bags[scope];
          if (raw === undefined) continue;
          const parsed = schema.safeParse(raw);
          if (
            (!parsed.success || !isDeepStrictEqual(raw, parsed.data)) &&
            !isDeepStrictEqual(bag, plugins[definition.id])
          )
            throw new Error(`Plugin ${definition.id} cannot rewrite an unsupported bag`);
        }
        if (bag !== undefined) {
          const parsed = schema.safeParse(bag);
          if (!parsed.success || !isDeepStrictEqual(parsed.data, bag))
            throw new Error(`Plugin ${definition.id} returned an invalid bag`);
        }
      }
      const previousBag = plugins[definition.id];
      if (!scope && isObject(bag) && isObject(previousBag) && bag.enabled !== previousBag.enabled)
        throw new Error('Reconciliation cannot toggle Plugin activation');
      if (bag === undefined) delete plugins[definition.id];
      else plugins[definition.id] = bag;
      record.plugins = plugins;
      files[path] = encode(record);
    }
    for (const [path, file] of Object.entries(result.files)) {
      if (
        PLUGIN.exec(path)?.[2] !== definition.id ||
        path.split('/').some((p) => !p || p === '.' || p === '..') ||
        !file ||
        typeof file.data !== 'string' ||
        Buffer.from(file.data, 'base64').toString('base64') !== file.data ||
        !['100644', '100755'].includes(file.mode)
      )
        throw new Error(`Plugin ${definition.id} wrote outside its file scope`);
      files[path] = file;
    }
  }
  repairConfiguration(files, [base, left, right], helpers);
  validateInput(files);
  validateReferences(files);
  const evidence: string[] = [];
  if (decisions.length || remaps.some((r) => Object.keys(r.boards).length || Object.keys(r.stories).length)) {
    const record = {
      version: 1,
      sources: { base: evidenceSource(baseSource), sides: [evidenceSource(leftSource), evidenceSource(rightSource)] },
      remaps,
      decisions: [...decisions].sort((a, b) => (canonicalValue(a) < canonicalValue(b) ? -1 : 1)),
    };
    const path = `plugins/git/merge-evidence/${mergeDigest(record)}.json`;
    files[path] = encode(record);
    evidence.push(path);
  }
  return { files, decisions, remaps, evidence, requests };
}
function freeze<T>(value: T): T {
  if (value && typeof value === 'object') {
    for (const child of Object.values(value)) freeze(child);
    Object.freeze(value);
  }
  return value;
}
function validateInput(files: MergeFiles) {
  for (const [path, file] of Object.entries(files)) {
    if (CORE.test(path)) {
      if (file.mode !== '100644') throw new Error(`Unsupported core mode at ${path}`);
      const value = json(file);
      const schema =
        path === 'rowbly.config.json' ? RowblyConfigSchema : BOARD.test(path) ? BoardConfigSchema : StorySchema;
      schema.parse(value);
      if (STORY.test(path) && path !== `boards/${value?.boardId}/stories/${value?.key}/story.json`)
        throw new Error(`Story identity does not match ${path}`);
      if (BOARD.test(path) && path !== `boards/${value?.id}/board.config.json`)
        throw new Error(`Board identity does not match ${path}`);
    }
  }
  if (!files['rowbly.config.json']) throw new Error('Missing Data Root configuration');
}
function mergeRecord(
  base: Record<string, unknown> | undefined,
  left: Record<string, unknown> | undefined,
  right: Record<string, unknown> | undefined,
  path: string,
  helpers: MergeHelpers,
): unknown {
  const special = ['description', ...(STORY.test(path) ? ['labels'] : ['stages', 'customFields'])];
  const ordinary = (record: Record<string, unknown> | undefined) =>
    record === undefined
      ? undefined
      : Object.fromEntries(Object.entries(record).filter(([key]) => !special.includes(key)));
  const result = helpers.value(ordinary(base), ordinary(left), ordinary(right), path);
  if (!isObject(result)) return result;
  for (const key of special) {
    const old = base?.[key],
      a = left?.[key],
      b = right?.[key];
    const value =
      key === 'description' && typeof a === 'string' && typeof b === 'string'
        ? helpers.text(typeof old === 'string' ? old : '', a, b, `${path}/${key}`)
        : key === 'labels' && Array.isArray(a) && Array.isArray(b)
          ? helpers.members(Array.isArray(old) ? old : [], a, b)
          : helpers.value(old, a, b, `${path}/${key}`);
    if (value !== undefined) result[key] = value;
  }
  for (const key of ['stages', 'customFields']) {
    const a = left?.[key],
      b = right?.[key],
      old = base?.[key];
    if (Array.isArray(a) && Array.isArray(b))
      result[key] = mergeDefinitions(Array.isArray(old) ? old : [], a, b, `${path}/${key}`, helpers);
  }
  // Preserve core serialization order, while retaining unknown keys and opaque bags exactly.
  const schema =
    path === 'rowbly.config.json' ? RowblyConfigSchema : BOARD.test(path) ? BoardConfigSchema : StorySchema;
  const parsed = schema.parse(result) as Record<string, unknown>;
  return Object.fromEntries(
    [...new Set([...Object.keys(parsed), ...Object.keys(result)])].map((key) => [key, result[key]]),
  );
}
function mergeDefinitions(
  base: unknown[],
  left: unknown[],
  right: unknown[],
  path: string,
  helpers: MergeHelpers,
): unknown[] {
  const keyed = (values: unknown[]) =>
    Object.fromEntries(
      values.map((v) => {
        if (!isObject(v) || typeof v.key !== 'string') throw new Error(`Invalid definitions at ${path}`);
        return [v.key, v];
      }),
    );
  const old = keyed(base),
    a = keyed(left),
    b = keyed(right);
  const merged = helpers.value(old, a, b, path) as Record<string, unknown>;
  const order = isDeepStrictEqual(
    left.map((v) => (v as { key: string }).key),
    base.map((v) => (v as { key: string }).key),
  )
    ? [...right, ...left]
    : [...left, ...right];
  const keys = [...new Set(order.map((v) => (v as { key: string }).key))].filter((key) => merged[key] !== undefined);
  if (
    !isDeepStrictEqual(left, base) &&
    !isDeepStrictEqual(right, base) &&
    canonicalValue(left) !== canonicalValue(right)
  )
    helpers.retain(path, 'deterministic definition order', base, left, right, keys);
  return keys.map((key) => merged[key]);
}
function remapBoards(
  base: MergeFiles,
  left: MergeFiles,
  right: MergeFiles,
  maps: [IdentityRemap, IdentityRemap],
  helpers: MergeHelpers,
) {
  const sides = [left, right];
  const boardPaths = (files: MergeFiles) =>
    Object.keys(files)
      .filter((p) => BOARD.test(p))
      .sort();
  const usedIds = new Set(
    [...boardPaths(base), ...boardPaths(left), ...boardPaths(right)].map((p) => BOARD.exec(p)![1]!),
  );
  const usedPrefixes = new Set([
    ...boardPaths(base).map((p) => json(base[p])?.keyPrefix),
    ...sides.flatMap((s) => boardPaths(s).map((p) => json(s[p])?.keyPrefix)),
  ]);
  function rename(side: number, path: string) {
    const files = sides[side]!,
      record = json(files[path])!,
      oldId = String(record.id),
      oldPrefix = String(record.keyPrefix);
    const id = unusedSlug(oldId, usedIds);
    let prefix = '';
    for (let n = 2; n < 1_000_000; n++) {
      const candidate = `${oldPrefix.slice(0, 5)}${n}`;
      if (!usedPrefixes.has(candidate)) {
        prefix = candidate;
        usedPrefixes.add(candidate);
        break;
      }
    }
    if (!prefix) throw new Error('No unused Board key prefix');
    maps[side]!.boards[oldId] = id;
    helpers.retain(
      path,
      'concurrent Board identity or prefix retained separately',
      undefined,
      record,
      { id, keyPrefix: prefix },
      { id, keyPrefix: prefix },
    );
    renameTree(files, `boards/${oldId}`, `boards/${id}`);
    record.id = id;
    record.keyPrefix = prefix;
    files[`boards/${id}/board.config.json`] = encode(record);
    for (const p of Object.keys(files).filter((p) => p.startsWith(`boards/${id}/stories/`) && STORY.test(p))) {
      const story = json(files[p])!,
        key = String(story.key),
        next = `${prefix}-${key.slice(key.lastIndexOf('-') + 1)}`;
      maps[side]!.stories[key] = next;
      renameTree(files, p.slice(0, -11), `boards/${id}/stories/${next}`);
      story.key = next;
      story.boardId = id;
      files[`boards/${id}/stories/${next}/story.json`] = encode(story);
    }
  }
  for (const path of boardPaths(left)) {
    if (
      !base[path] &&
      right[path] &&
      !isDeepStrictEqual(subtree(left, path.slice(0, -18)), subtree(right, path.slice(0, -18)))
    ) {
      const l = json(left[path])!,
        r = json(right[path])!;
      const loser =
        canonicalValue([l.createdAt, maps[0].source]) < canonicalValue([r.createdAt, maps[1].source]) ? 1 : 0;
      rename(loser, path);
    }
  }
  const seen = new Map<string, string>();
  for (const [n, files] of sides.entries())
    for (const path of boardPaths(files)) {
      const record = json(files[path])!,
        prefix = String(record.keyPrefix),
        id = String(record.id);
      const prior = seen.get(prefix);
      if (prior && prior !== id) rename(n, path);
      else seen.set(prefix, id);
    }
}
function remapStories(
  base: MergeFiles,
  left: MergeFiles,
  right: MergeFiles,
  maps: [IdentityRemap, IdentityRemap],
  helpers: MergeHelpers,
) {
  const sides = [left, right];
  const used = new Map<string, number>();
  for (const files of [base, ...sides])
    for (const path of Object.keys(files)) {
      const match = /^boards\/([^/]+)\/stories\/[^/]+-(\d+)\//.exec(path);
      if (match) used.set(match[1]!, Math.max(used.get(match[1]!) ?? 0, Number(match[2])));
    }
  for (const path of Object.keys(left)
    .filter((p) => STORY.test(p))
    .sort()) {
    if (!right[path]) continue;
    const l = json(left[path])!,
      r = json(right[path])!,
      old = json(base[path]);
    const recreated = old && (l.createdAt !== old.createdAt || r.createdAt !== old.createdAt);
    if (
      (!old || recreated) &&
      !isDeepStrictEqual(subtree(left, path.slice(0, -11)), subtree(right, path.slice(0, -11)))
    ) {
      const loser =
        canonicalValue([l.createdAt, maps[0].source]) < canonicalValue([r.createdAt, maps[1].source]) ? 1 : 0;
      const side = sides[loser]!,
        story = json(side[path])!,
        board = String(story.boardId),
        oldKey = String(story.key);
      const boardRecord = json(side[`boards/${board}/board.config.json`])!;
      const next = (used.get(board) ?? 0) + 1;
      used.set(board, next);
      const key = `${boardRecord.keyPrefix}-${next}`;
      maps[loser]!.stories[oldKey] = key;
      helpers.retain(path, 'distinct concurrent Story identities', old, l, r, {
        retained: [oldKey, key],
        source: maps[loser]!.source,
      });
      renameTree(side, path.slice(0, -11), `boards/${board}/stories/${key}`);
      story.key = key;
      side[`boards/${board}/stories/${key}/story.json`] = encode(story);
    }
  }
}
function splitFieldTypes(base: MergeFiles, left: MergeFiles, right: MergeFiles, helpers: MergeHelpers) {
  for (const path of Object.keys(left).filter((p) => p === 'rowbly.config.json' || BOARD.test(p))) {
    const a = json(left[path]),
      b = json(right[path]);
    if (!a || !b || !Array.isArray(a.customFields) || !Array.isArray(b.customFields)) continue;
    const used = new Set([...a.customFields, ...b.customFields].map((d) => String(d.key)));
    for (const def of a.customFields) {
      const other: Record<string, unknown> | undefined = b.customFields.find((d) => d.key === def.key);
      if (!other || def.type === other.type) continue;
      const key = unusedSlug(String(other.key), used),
        oldKey = String(other.key);
      helpers.retain(
        `${path}/customFields/${oldKey}`,
        'incompatible Custom Field types retained separately',
        json(base[path])?.customFields,
        def,
        other,
        { ...other, key },
      );
      other.key = key;
      const scope = BOARD.exec(path)?.[1];
      for (const storyPath of Object.keys(right).filter(
        (p) => STORY.test(p) && (!scope || p.startsWith(`boards/${scope}/`)),
      )) {
        const board = json(right[`boards/${STORY.exec(storyPath)![1]}/board.config.json`])!;
        if (!scope && board.customFields !== undefined) continue;
        const story = json(right[storyPath])!;
        if (isObject(story.customFields) && oldKey in story.customFields) {
          story.customFields[key] = story.customFields[oldKey];
          const counterpart = json(left[storyPath]);
          if (isObject(counterpart?.customFields) && oldKey in counterpart.customFields)
            story.customFields[oldKey] = counterpart.customFields[oldKey];
          else delete story.customFields[oldKey];
          right[storyPath] = encode(story);
        }
      }
    }
    right[path] = encode(b);
  }
}
/** Restore only constraints needed by retained records, without destructive doctor fixes. */
function repairConfiguration(files: MergeFiles, sources: MergeFiles[], helpers: MergeHelpers) {
  const root = json(files['rowbly.config.json'])!;
  for (const path of Object.keys(files)
    .filter((p) => BOARD.test(p))
    .sort()) {
    const board = json(files[path])!,
      boardId = String(board.id);
    const stories = Object.keys(files)
      .filter((p) => p.startsWith(`boards/${boardId}/stories/`) && STORY.test(p))
      .sort();
    let stages = (board.stages ?? root.stages ?? DEFAULT_STAGES) as { key: string; name: string }[];
    let fields = (board.customFields ?? root.customFields ?? []) as CustomFieldDef[];
    const sourceDefinitions = (key: string) =>
      sources.flatMap((source) => {
        const b = json(source[path]),
          r = json(source['rowbly.config.json']);
        return (b?.[key] ?? r?.[key] ?? (key === 'stages' ? DEFAULT_STAGES : [])) as Record<string, unknown>[];
      });
    let changedStages = false,
      changedFields = false;
    for (const storyPath of stories) {
      const story = StorySchema.parse(json(files[storyPath]));
      if (!['backlog', 'done'].includes(story.stage) && !stages.some((s) => s.key === story.stage)) {
        const definition = sourceDefinitions('stages').find((s) => s.key === story.stage);
        if (!definition) throw new Error(`No source definition for retained Stage ${story.stage}`);
        helpers.retain(
          `${path}/stages`,
          'restored Stage referenced by retained Story',
          stages,
          undefined,
          definition,
          definition,
        );
        stages = [...stages, definition as { key: string; name: string }];
        changedStages = true;
      }
      for (const [key, value] of Object.entries(story.customFields)) {
        if (!fields.some((f) => f.key === key)) {
          const definition = sourceDefinitions('customFields').find((f) => f.key === key);
          if (!definition) throw new Error(`No source definition for retained Custom Field ${key}`);
          helpers.retain(
            `${path}/customFields`,
            'restored referenced Custom Field',
            fields,
            undefined,
            definition,
            definition,
          );
          fields = [...fields, definition as unknown as CustomFieldDef];
          changedFields = true;
        }
        const def = fields.find((f) => f.key === key)!;
        if (!fieldValueError(def, value)) continue;
        const repaired = structuredClone(def);
        if (repaired.type === 'select' && typeof value === 'string')
          repaired.options = [...new Set([...repaired.options, value])];
        else if (repaired.type === 'multiselect' && Array.isArray(value))
          repaired.options = [...new Set([...repaired.options, ...value])];
        else if (repaired.type === 'number' && typeof value === 'number') {
          if (repaired.min !== undefined && value < repaired.min) repaired.min = value;
          if (repaired.max !== undefined && value > repaired.max) repaired.max = value;
          if (!Number.isInteger(value)) repaired.integer = false;
        }
        if (fieldValueError(repaired, value)) throw new Error(`Incompatible retained Custom Field ${key}`);
        helpers.retain(`${path}/customFields/${key}`, 'constraint relaxed to retain value', def, def, value, repaired);
        fields = fields.map((f) => (f.key === key ? repaired : f));
        changedFields = true;
      }
    }
    for (const def of fields)
      if (def.required && stories.some((p) => !(def.key in (json(files[p])!.customFields as object)))) {
        helpers.retain(
          `${path}/customFields/${def.key}/required`,
          'required relaxed instead of inventing a value',
          true,
          true,
          undefined,
          false,
        );
        fields = fields.map((f) => (f.key === def.key ? { ...f, required: false } : f));
        changedFields = true;
      }
    if (changedStages) board.stages = stages;
    if (changedFields) board.customFields = fields;
    files[path] = encode(board);
    // Rank ties are deterministic, retaining all Stories, with the original Rank in evidence.
    const ranks = new Set<string>();
    for (const p of stories) {
      const story = json(files[p])!,
        pair = `${story.stage}/${story.rank}`;
      if (ranks.has(pair)) {
        const last =
          stories
            .map((p) => String(json(files[p])?.rank))
            .sort()
            .at(-1) ?? null;
        const rank = rankAfter(last);
        helpers.retain(`${p}/rank`, 'Rank tie repaired', story.rank, story.rank, rank, rank);
        story.rank = rank;
        files[p] = encode(story);
      }
      ranks.add(`${story.stage}/${story.rank}`);
    }
  }
}
function validateReferences(files: MergeFiles) {
  const root = RowblyConfigSchema.parse(json(files['rowbly.config.json']));
  const prefixes = new Set<string>();
  for (const path of Object.keys(files).filter((p) => BOARD.test(p))) {
    const board = BoardConfigSchema.parse(json(files[path]));
    if (prefixes.has(board.keyPrefix)) throw new Error('Duplicate Board key prefix after reconciliation');
    prefixes.add(board.keyPrefix);
  }
  for (const path of Object.keys(files).filter((p) => STORY.test(p))) {
    const story = StorySchema.parse(json(files[path]));
    const board = BoardConfigSchema.parse(json(files[`boards/${story.boardId}/board.config.json`]));
    if (!story.key.startsWith(`${board.keyPrefix}-`)) throw new Error(`Story key prefix does not match ${path}`);
    const stages = board.stages ?? root.stages ?? DEFAULT_STAGES;
    if (!['backlog', 'done'].includes(story.stage) && !stages.some((s) => s.key === story.stage))
      throw new Error(`Missing retained Stage at ${path}`);
    validateFieldValues(board.customFields ?? root.customFields ?? [], story.customFields, { requireRequired: true });
  }
  for (const path of Object.keys(files)) {
    const scope = PLUGIN.exec(path)?.[1];
    if (scope && !files[`${scope}/board.config.json`]) throw new Error(`Orphan Plugin scope at ${path}`);
    const story = /^(boards\/[^/]+\/stories\/[^/]+)\/plugins\//.exec(path)?.[1];
    if (story && !files[`${story}/story.json`]) throw new Error(`Orphan Plugin scope at ${path}`);
  }
}

function retainEditedParents(base: MergeFiles, left: MergeFiles, right: MergeFiles, helpers: MergeHelpers) {
  for (const path of Object.keys(base)
    .filter((p) => BOARD.test(p) || STORY.test(p))
    .sort()) {
    const prefix = path.slice(0, path.lastIndexOf('/'));
    for (const [deleted, edited] of [
      [left, right],
      [right, left],
    ]) {
      if (!deleted || !edited || deleted[path] || !edited[path]) continue;
      if (isDeepStrictEqual(subtree(base, prefix), subtree(edited, prefix))) continue;
      helpers.retain(
        path,
        'deletion intent retained; edited complete subtree survives',
        subtree(base, prefix),
        undefined,
        subtree(edited, prefix),
        subtree(edited, prefix),
      );
      Object.assign(deleted, Object.fromEntries(Object.entries(base).filter(([p]) => p.startsWith(`${prefix}/`))));
    }
  }
}

/** Prior evidence stays additive; never recursively base64-embed its payload in the next record. */
function evidenceSource(source: MergeSource) {
  const files: MergeFiles = {},
    evidence: { path: string; digest: string }[] = [];
  for (const [path, file] of Object.entries(source.files)) {
    if (path.startsWith('plugins/git/merge-evidence/')) evidence.push({ path, digest: mergeDigest(file) });
    else files[path] = file;
  }
  return evidence.length
    ? { id: source.id, files, evidence: evidence.sort((a, b) => (a.path < b.path ? -1 : 1)) }
    : source;
}
