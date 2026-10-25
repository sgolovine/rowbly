import { isDeepStrictEqual } from 'node:util';
import type { GitRebaseHistory, GitReplayData, GitReplayResult } from '../../storage/gitRebaseTypes';
import { type DataMergeResult, type MergeSource, mergeData } from './mergeData';
import { mergeReplayProjection } from './mergeReplayProjection';
import { mergeDigest } from './reconciliation';
import {
  emptyReplayProjection,
  type ReplayProjection,
  replayProjectionFor,
  retainReplayProvenance,
  transportReplayData,
} from './replayData';
import type { AnyPluginDefinition } from './types';

/** One finite original DAG and its correspondence during an actual isolated pull. No live effects. */
export function createReplayHistory(
  history: GitRebaseHistory,
  registry: readonly AnyPluginDefinition[],
): GitReplayData {
  const nodes = new Map(history.nodes.map((node) => [node.id, node]));
  const maps = new Map<string, ReplayProjection>();
  const evidence = new Set<string>();
  let repairs = 0;
  const transport = (source: MergeSource, projection = emptyReplayProjection()) =>
    transportReplayData(source, projection, registry);
  maps.set(history.upstream.id, transport(history.upstream).projection);
  const combine = (base: MergeSource, current: MergeSource, source: MergeSource, replay = true) =>
    mergeData(base, current, source, registry, replay ? {} : undefined);
  const retain = (result: DataMergeResult, ...sources: MergeSource[]) => {
    // Omitted merge nodes and pending deletions cannot discard earlier append-only proof records.
    for (const source of sources)
      for (const [path, file] of Object.entries(source.files)) {
        if (!path.startsWith('plugins/git/merge-evidence/')) continue;
        if (result.files[path] && !isDeepStrictEqual(result.files[path], file))
          throw new Error(`Content-addressed merge evidence disagrees at ${path}`);
        result.files[path] = file;
      }
    repairs += result.decisions.length;
    for (const path of result.evidence) evidence.add(path);
  };
  const outcome = (source: MergeSource): GitReplayResult => ({
    files: source.files,
    evidence: [...evidence],
    decisions: [],
    repairs,
  });
  async function advance(current: MergeSource, result: DataMergeResult): Promise<void> {
    for (const [id, before] of maps) {
      const raw = await history.read(id);
      const composed = replayProjectionFor({ id: current.id, files: raw.files }, before, result);
      // The same owner callback recognizes which raw identities actually exist in this ancestor.
      maps.set(id, transport(raw, composed).projection);
    }
  }
  async function remember(id: string): Promise<void> {
    const raw = await history.read(id);
    const inherited = (await history.contains(id, history.upstream.id)) ? maps.get(history.upstream.id) : undefined;
    maps.set(id, transport(raw, inherited).projection);
  }
  async function ensure(id: string, current: MergeSource): Promise<MergeSource> {
    if (maps.has(id)) return current;
    if (await history.contains(id, current.id)) {
      await remember(id);
      return current;
    }
    const node = nodes.get(id);
    if (!node?.parents.length) throw new Error('Unprovable skipped replay correspondence requires manual resolution');
    for (const parent of node.parents) current = await ensure(parent, current);
    const committed = await history.read(id);
    if (node.parents.length === 1) {
      const parent = node.parents[0];
      if (!parent) throw new Error('Missing replay parent');
      const base = transport(await history.read(parent), maps.get(parent));
      const next = transport(committed, maps.get(parent));
      const result = combine(base.source, current, next.source, false);
      if (!isDeepStrictEqual(result.files, current.files) || result.decisions.length || result.evidence.length)
        throw new Error('Unprovable patch-skipped Rowbly correspondence requires manual resolution');
      maps.set(id, replayProjectionFor(committed, next.projection, result));
      return current;
    }
    if (node.parents.length !== 2 || !node.base)
      throw new Error('Unsupported merge topology requires manual resolution before Sync');
    const parents = await Promise.all(node.parents.map((parent) => history.read(parent)));
    const [left, right] = parents;
    if (!left || !right) throw new Error('Missing original merge parents');
    const baseline = combine(await history.read(node.base), left, right, false);
    const projection = mergeReplayProjection(
      parents.map((parent) => ({
        before: replayProjectionFor(parent, transport(parent).projection, baseline),
        after: maps.get(parent.id) ?? emptyReplayProjection(),
      })),
    );
    const baselineSource = { id: `merge-baseline:${id}`, files: baseline.files };
    const projectedBase = transport(baselineSource, projection),
      projectedMerge = transport(committed, projection);
    const result = combine(projectedBase.source, current, projectedMerge.source);
    await advance(current, result);
    const final = replayProjectionFor(committed, projectedMerge.projection, result);
    maps.set(id, final);
    retain(result, baselineSource, committed, current, projectedBase.source, projectedMerge.source);
    const path = retainReplayProvenance(
      result,
      { base: baselineSource, current, commit: committed },
      { base: projectedBase.source, current, commit: projectedMerge.source },
      final,
      { parents: node.parents, baseline: baselineSource, committed },
    );
    evidence.add(path);
    return { id: current.id, files: result.files };
  }
  return {
    async replay(step, originalCurrent) {
      const node = nodes.get(step.commit);
      if (node?.parents.length !== 1 || node.parents[0] !== step.base || originalCurrent.id !== step.current)
        throw new Error('Unexpected original replay lineage requires manual resolution');
      const current = await ensure(step.base, originalCurrent);
      const originalBase = await history.read(step.base),
        originalCommit = await history.read(step.commit);
      const base = transport(originalBase, maps.get(step.base)),
        next = transport(originalCommit, maps.get(step.base));
      const result = combine(base.source, current, next.source);
      await advance(current, result);
      const projection = replayProjectionFor(originalCommit, next.projection, result);
      maps.set(step.commit, projection);
      retain(result, originalBase, originalCurrent, originalCommit, current, base.source, next.source);
      evidence.add(
        retainReplayProvenance(
          result,
          { base: originalBase, current: originalCurrent, commit: originalCommit },
          { base: base.source, current, commit: next.source },
          projection,
        ),
      );
      return outcome({ id: current.id, files: result.files });
    },
    async finish(originalCurrent, pending) {
      const current = await ensure(history.old.id, originalCurrent);
      if (isDeepStrictEqual(pending.files, history.old.files)) return outcome(current);
      const projection = maps.get(history.old.id);
      const base = transport(history.old, projection),
        next = transport(pending, projection);
      const result = combine(base.source, current, next.source);
      retain(result, history.old, current, pending, base.source, next.source);
      evidence.add(
        retainReplayProvenance(
          result,
          { base: history.old, current, commit: pending },
          { base: base.source, current, commit: next.source },
          replayProjectionFor(pending, next.projection, result),
        ),
      );
      return outcome({ id: `pending:${mergeDigest(result.files)}`, files: result.files });
    },
  };
}
