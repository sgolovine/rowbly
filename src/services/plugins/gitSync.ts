import { randomBytes } from 'node:crypto';
import { join } from 'node:path';
import { isDeepStrictEqual } from 'node:util';
import { ConflictError, DataIntegrityError, PluginError } from '../../core';
import type { DataRoot } from '../../schemas';
import { createRepositories } from '../../storage';
import { gitText } from '../../storage/gitProcess';
import { synchronizeGitRebase } from '../../storage/gitRebaseSync';
import { canonicalGitRoot, requireRepository, rootGitKey, withGitWorker } from '../../storage/gitRepository';
import { configuredUpstream, GitSyncPushError, synchronizeGit } from '../../storage/gitSync';
import {
  type GitSyncReceipt,
  type GitSyncState,
  localHost,
  readSyncState,
  syncProcessAlive,
  writeSyncState,
} from '../../storage/gitSyncState';
import { coordinated, outsideCoordination } from '../coordination';
import { currentScope } from './executionScope';
import { mergeData } from './mergeData';
import { createReplayHistory } from './replayHistory';
import type { AnyPluginDefinition } from './types';

export interface GitSyncOptions {
  enabled: boolean;
  intervalSeconds: number;
  authorName?: string;
  authorEmail?: string;
}
export type GitSyncOptionsSource = (localData: unknown) => GitSyncOptions;
export interface GitSyncStatus extends Partial<Omit<GitSyncState, 'receipts'>> {
  enabled: boolean;
  manualAvailable: boolean;
  intervalSeconds: number;
  branch?: string;
  upstream?: string;
  prerequisite?: string;
}
export interface GitManualSyncResult {
  id: string;
  mode: 'rebase';
  commit: string;
  upstream: string;
  evidence: string[];
  repairs: number;
  pushed: true;
}
interface Resource {
  root: DataRoot;
  id: string;
  owner?: object;
  source: GitSyncOptionsSource;
  registry: readonly AnyPluginDefinition[];
  warn(message: string): void;
  timer?: ReturnType<typeof setTimeout>;
}
const resources = new Map<string, Resource>();
const jobs = new Map<string, { root: string; done: Promise<void> }>();
const disposed = new WeakSet<object>();
const manualOwners = new Map<string, object | undefined>();
function manualAlive(pending: NonNullable<GitSyncState['manual']>): boolean {
  if (!syncProcessAlive(pending.pid, pending.host)) return false;
  if (pending.pid !== process.pid || pending.host !== localHost()) return true;
  const owner = manualOwners.get(pending.id);
  return manualOwners.has(pending.id) && !(owner && disposed.has(owner));
}
export function disposeSyncOwner(owner: object): void {
  disposed.add(owner);
  for (const [file, resource] of resources)
    if (resource.owner === owner) {
      clearTimeout(resource.timer);
      resources.delete(file);
    }
}
export async function drainSyncQueue(root?: DataRoot): Promise<void> {
  const path = root ? (await canonicalGitRoot(root)).path : undefined;
  while (true) {
    const waiting = [...jobs.values()].filter((job) => !path || job.root === path);
    if (!waiting.length) return;
    await Promise.all(waiting.map((job) => job.done));
  }
}
function initial(intervalSeconds: number): GitSyncState {
  const anchor = Date.now();
  return { version: 1, anchor, nextDue: anchor + intervalSeconds * 1000, intervalSeconds, receipts: {} };
}
function errorText(err: unknown): string {
  return (err instanceof Error ? err.message : String(err))
    .replace(/(https?:\/\/)[^/\s@]+@/g, '$1[redacted]@')
    .slice(0, 2000);
}
async function preferences(resource: Resource): Promise<GitSyncOptions & { manualAvailable: boolean }> {
  const repos = createRepositories(resource.root);
  const config = await repos.rootConfig.get();
  const options = resource.source((await repos.localState.get()).plugins?.[resource.id]);
  const manualAvailable =
    config.plugins?.[resource.id]?.enabled === true && !(resource.owner && disposed.has(resource.owner));
  return {
    ...options,
    manualAvailable,
    enabled: manualAvailable && options.enabled,
  };
}
/** Exact manual receipts live in the existing private state, independently of last/active. */
function receipt(state: GitSyncState, value: GitSyncReceipt): void {
  const existing = Object.hasOwn(state.receipts, value.id) ? state.receipts[value.id] : undefined;
  if (existing && !isDeepStrictEqual(existing, value)) throw new Error('Manual Sync already has a terminal receipt');
  state.receipts[value.id] = value;
}
function interrupted(state: GitSyncState): void {
  const active = state.active;
  if (!active) return;
  state.last = {
    id: active.id,
    mode: active.mode,
    kind: 'interrupted',
    message: 'Previous run interrupted; local recovery completed; its push result is unknown',
    startedAt: active.startedAt,
    finishedAt: Date.now(),
    evidence: [],
    repairs: 0,
    pushed: false,
  };
  if (active.mode === 'rebase') receipt(state, { ...state.last, id: active.id, mode: 'rebase', pushed: false });
  delete state.active;
}
function cancelManual(state: GitSyncState, message: string, kind: 'failed' | 'interrupted' = 'interrupted'): void {
  const pending = state.manual;
  if (!pending) return;
  const value: GitSyncReceipt = {
    id: pending.id,
    mode: 'rebase',
    kind,
    message,
    startedAt: pending.requestedAt,
    finishedAt: Date.now(),
    evidence: [],
    repairs: 0,
    pushed: false,
  };
  receipt(state, value);
  state.last = value;
  delete state.manual;
}
function arm(file: string, resource: Resource, due: number) {
  clearTimeout(resource.timer);
  if (resources.get(file) !== resource) return;
  resource.timer = setTimeout(
    () => {
      resource.timer = undefined;
      enqueue(file, resource);
    },
    Math.min(Math.max(0, due - Date.now()), 2_147_483_647),
  );
  resource.timer.unref();
}
function enqueue(file: string, resource: Resource): Promise<void> {
  const prior = jobs.get(file);
  if (prior) return prior.done;
  const startedAt = Date.now();
  let admittedId: string | undefined;
  let followup = false;
  const done = outsideCoordination(async () => {
    const repo = await requireRepository(resource.root);
    await withGitWorker(repo, async () => {
      const target = await configuredUpstream(repo);
      const admitted = await coordinated(resource.root, 'git.sync.admit', async () => {
        const current = await preferences(resource);
        const state = (await readSyncState(file)) ?? initial(current.intervalSeconds);
        clearTimeout(resource.timer);
        interrupted(state);
        if (state.manual && !manualAlive(state.manual))
          cancelManual(state, 'Manual Sync requester interrupted; press Sync again');
        if (state.manual && (state.manual.pid !== process.pid || state.manual.host !== localHost())) {
          // Joining processes wait for the receipt; startup cannot execute somebody else's request.
          await writeSyncState(file, state);
          if (current.enabled) arm(file, resource, Date.now() + 1000);
          return null;
        }
        if (!current.manualAvailable) cancelManual(state, 'Git is Off or this Git host has closed');
        if (state.manual && !isDeepStrictEqual(state.manual.target, target))
          cancelManual(state, 'Git branch or upstream changed after manual Sync was requested', 'failed');
        if (!current.enabled && !state.manual) {
          delete state.requested;
          await writeSyncState(file, state);
          return null;
        }
        if (!state.manual && state.target && !isDeepStrictEqual(state.target, target)) {
          state.target = target;
          await writeSyncState(file, state);
          throw new Error('Git branch or upstream changed since scheduling; next interval uses the current branch');
        }
        state.target = target;
        if (state.intervalSeconds !== current.intervalSeconds) {
          state.intervalSeconds = current.intervalSeconds;
          state.nextDue = state.anchor + current.intervalSeconds * 1000;
        }
        if (!state.manual && !state.requested && state.nextDue > Date.now()) {
          await writeSyncState(file, state);
          arm(file, resource, state.nextDue);
          return null;
        }
        const active: NonNullable<GitSyncState['active']> = {
          id: state.manual?.id ?? state.requested ?? randomBytes(8).toString('hex'),
          mode: state.manual ? 'rebase' : 'merge',
          pid: process.pid,
          host: localHost(),
          startedAt: Date.now(),
          phase: 'admitted',
        };
        delete state.requested;
        delete state.manual;
        state.active = active;
        admittedId = active.id;
        await writeSyncState(file, state);
        return { current, active };
      });
      if (!admitted) return;
      let last: GitSyncState['last'];
      const phase = async (name: string) =>
        coordinated(resource.root, 'git.sync.phase', async () => {
          const state = await readSyncState(file);
          if (state?.active?.id !== admitted.active.id) throw new Error('Git synchronization run identity changed');
          state.active.phase = name;
          await writeSyncState(file, state);
        });
      try {
        const validate = async (files: Parameters<typeof mergeData>[0]['files']) => {
          mergeData(
            { id: 'validation', files },
            { id: 'validation', files },
            { id: 'validation', files },
            resource.registry,
          );
        };
        const capture = <T>(read: () => Promise<T>) => coordinated(resource.root, 'git.sync.capture', read);
        const options = { ...admitted.current, frequency: 'change' as const };
        const result =
          admitted.active.mode === 'rebase'
            ? await synchronizeGitRebase(
                repo,
                resource.root,
                options,
                capture,
                (history) => createReplayHistory(history, resource.registry),
                phase,
                validate,
                target,
              )
            : await synchronizeGit(
                repo,
                resource.root,
                options,
                capture,
                (base, left, right) => mergeData(base, left, right, resource.registry),
                phase,
                validate,
                target,
              );
        last = {
          id: admitted.active.id,
          mode: admitted.active.mode,
          kind: 'synchronized',
          message: 'Synchronized with configured upstream',
          startedAt: admitted.active.startedAt,
          finishedAt: Date.now(),
          commit: result.commit,
          upstream: result.upstream,
          evidence: result.evidence,
          repairs: result.repairs,
          pushed: result.pushed,
        };
      } catch (err) {
        const commit = await gitText(repo.top, ['rev-parse', 'HEAD']).catch(() => undefined);
        last = {
          id: admitted.active.id,
          mode: admitted.active.mode,
          kind: 'failed',
          message: errorText(err),
          startedAt: admitted.active.startedAt,
          finishedAt: Date.now(),
          commit,
          evidence: err instanceof GitSyncPushError ? err.local.evidence : [],
          repairs: err instanceof GitSyncPushError ? err.local.repairs : 0,
          upstream: err instanceof GitSyncPushError ? err.local.upstream : undefined,
          pushed: false,
        };
      }
      await coordinated(resource.root, 'git.sync.finish', async () => {
        const live = resources.get(file) ?? resource;
        const current = await preferences(live),
          state = (await readSyncState(file)) ?? initial(current.intervalSeconds);
        if (state.active?.id !== admitted.active.id) throw new Error('Git synchronization completion identity changed');
        delete state.active;
        if (admitted.active.mode === 'rebase') {
          if (!last) throw new Error('Manual Sync finished without a result');
          receipt(state, { ...last, id: admitted.active.id, mode: 'rebase', pushed: last.pushed === true });
        }
        state.last = last;
        state.anchor = Date.now();
        state.intervalSeconds = current.intervalSeconds;
        state.nextDue = state.anchor + current.intervalSeconds * 1000;
        await writeSyncState(file, state);
        followup = !!state.manual;
        if (current.enabled) arm(file, live, state.nextDue);
      });
    });
  }).catch(async (err) => {
    const live = resources.get(file) ?? resource;
    let manualFailure = false;
    try {
      await coordinated(live.root, 'git.sync.failed', async () => {
        const current = await preferences(live);
        const state = (await readSyncState(file)) ?? initial(current.intervalSeconds);
        manualFailure = !!state.manual || state.active?.mode === 'rebase';
        if (state.manual) cancelManual(state, errorText(err), 'failed');
        // Another process may have admitted a run while this worker was waiting.
        if ((!state.active || state.active.id === admittedId) && (state.active || !manualFailure)) {
          const active = state.active;
          delete state.active;
          delete state.requested;
          state.last = {
            id: admittedId,
            mode: active?.mode ?? 'merge',
            kind: 'failed',
            message: errorText(err),
            startedAt,
            finishedAt: Date.now(),
            evidence: [],
            repairs: 0,
            pushed: false,
          };
          if (active?.mode === 'rebase')
            receipt(state, { ...state.last, id: active.id, mode: 'rebase', pushed: false });
          state.anchor = Date.now();
          state.intervalSeconds = current.intervalSeconds;
          state.nextDue = state.anchor + Math.max(1000, current.intervalSeconds * 1000);
        }
        await writeSyncState(file, state);
        if (current.enabled) arm(file, live, Math.max(Date.now() + 1000, state.nextDue));
      });
      if (!manualFailure) resource.warn(`Git synchronization: ${errorText(err)}`);
    } catch (failure) {
      // Recovery or storage can itself be unavailable. Retry admission after a bounded pause;
      // it still reads the latest enabled preference before starting any Git work.
      live.warn(`Git synchronization recovery: ${errorText(failure)}`);
      if (!(live.owner && disposed.has(live.owner))) arm(file, live, Date.now() + 30_000);
    }
  });
  jobs.set(file, { root: resource.root.path, done });
  void done.finally(() => {
    if (jobs.get(file)?.done === done) {
      jobs.delete(file);
      if (followup) void enqueue(file, resources.get(file) ?? resource);
    }
  });
  return done;
}

export function createGitSync(
  suppliedRoot: DataRoot,
  id: string,
  registry: readonly AnyPluginDefinition[],
  warn: (message: string) => void,
  owner?: object,
) {
  let binding: Promise<{ root: DataRoot; file: string }> | undefined;
  const location = () => {
    if (!binding) {
      const found = (async () => {
        const root = await canonicalGitRoot(suppliedRoot);
        const file = join((await requireRepository(root)).gitDir, 'rowbly', `sync-${id}-${rootGitKey(root)}.json`);
        return { root, file };
      })();
      binding = found;
      void found.catch(() => {
        if (binding === found) binding = undefined;
      });
    }
    return binding;
  };
  async function setup(source: GitSyncOptionsSource): Promise<{ file: string; resource: Resource } | null> {
    const { root, file } = await location();
    if (owner && disposed.has(owner)) return null;
    let resource = resources.get(file);
    if (!resource) resource = { root, id, registry, source, warn, owner };
    else {
      resource.source = source;
      resource.registry = registry;
      if (owner) resource.owner = owner;
    }
    resources.set(file, resource);
    return { file, resource };
  }
  async function status(source: GitSyncOptionsSource): Promise<GitSyncStatus> {
    const { root, file } = await location();
    const resource: Resource = resources.get(file) ?? { root, id, registry, source, warn, owner };
    const state = await coordinated(root, 'git.sync.read', async () => {
      const current = await preferences(resource),
        state = await readSyncState(file);
      if (
        state?.active &&
        (!syncProcessAlive(state.active.pid, state.active.host) ||
          (state.active.pid === process.pid && !jobs.has(file)))
      ) {
        interrupted(state);
        await writeSyncState(file, state);
      }
      if (state?.manual && !manualAlive(state.manual)) {
        cancelManual(state, 'Manual Sync requester interrupted; press Sync again');
        await writeSyncState(file, state);
      }
      const { receipts: _receipts, ...visible } = state ?? {};
      return {
        ...visible,
        enabled: current.enabled,
        manualAvailable: current.manualAvailable,
        intervalSeconds: current.intervalSeconds,
      };
    });
    try {
      const upstream = await configuredUpstream(await requireRepository(root));
      return { ...state, branch: upstream.branch, upstream: `${upstream.remote}/${upstream.mergeRef}` };
    } catch (err) {
      return { ...state, prerequisite: errorText(err) };
    }
  }
  return {
    syncStatus: status,
    async resumeSync(source: GitSyncOptionsSource): Promise<void> {
      const scope = currentScope();
      if (scope && (scope.stage !== 'reaction' || scope.ended))
        throw new PluginError('Git scheduling is available only at start or in a live reaction');
      if (owner && disposed.has(owner)) return;
      const found = await setup(source);
      if (!found) return;
      const { file, resource } = found;
      const root = resource.root;
      const target = await configuredUpstream(await requireRepository(root)).catch(() => undefined);
      await coordinated(root, 'git.sync.schedule', async () => {
        if (owner && disposed.has(owner)) return;
        clearTimeout(resource.timer);
        const current = await preferences(resource);
        if (owner && disposed.has(owner)) return;
        if (!current.enabled) {
          const state = await readSyncState(file);
          if (state) {
            delete state.requested;
            if (!current.manualAvailable) cancelManual(state, 'Git is Off; press Sync after enabling Git');
            else if (state.manual && !manualAlive(state.manual))
              cancelManual(state, 'Manual Sync requester interrupted; press Sync again');
            if (state.active && !syncProcessAlive(state.active.pid, state.active.host)) interrupted(state);
            await writeSyncState(file, state);
          }
          return;
        }
        const state = (await readSyncState(file)) ?? initial(current.intervalSeconds);
        if (state.manual && !manualAlive(state.manual))
          cancelManual(state, 'Manual Sync requester interrupted; press Sync again');
        state.intervalSeconds = current.intervalSeconds;
        state.target = target;
        state.nextDue = state.anchor + current.intervalSeconds * 1000;
        await writeSyncState(file, state);
        if (state.nextDue <= Date.now() || state.requested) enqueue(file, resource);
        else arm(file, resource, state.nextDue);
      });
    },
    async requestSync(source: GitSyncOptionsSource): Promise<GitSyncStatus> {
      const scope = currentScope();
      if (scope && (!['command', 'screen'].includes(scope.stage) || scope.ended))
        throw new PluginError('Git synchronization can be requested only from a command or screen');
      if (owner && disposed.has(owner)) throw new Error('This Git host has closed');
      const found = await setup(source);
      if (!found) throw new Error('This Git host has closed');
      const { file, resource } = found;
      const root = resource.root;
      const target = await configuredUpstream(await requireRepository(root)).catch(() => undefined);
      const request = await coordinated(root, 'git.sync.request', async () => {
        if (owner && disposed.has(owner)) throw new Error('This Git host has closed');
        const current = await preferences(resource);
        if (owner && disposed.has(owner)) throw new Error('This Git host has closed');
        if (!current.enabled) throw new Error('Automatic Merge Conflict Resolution is Off');
        const state = (await readSyncState(file)) ?? initial(current.intervalSeconds);
        if (
          state.active &&
          (!syncProcessAlive(state.active.pid, state.active.host) ||
            (state.active.pid === process.pid && !jobs.has(file)))
        )
          interrupted(state);
        if (state.active || state.manual) {
          await writeSyncState(file, state);
          return false;
        }
        state.target = target;
        state.requested ??= randomBytes(8).toString('hex');
        await writeSyncState(file, state);
        return true;
      });
      if (request) await enqueue(file, resource);
      return status(source);
    },
    async requestRebaseSync(source: GitSyncOptionsSource): Promise<GitManualSyncResult> {
      const scope = currentScope();
      if (scope && (!['command', 'screen'].includes(scope.stage) || scope.ended))
        throw new PluginError('Manual Sync can be requested only from a live command or screen');
      if (owner && disposed.has(owner)) throw new ConflictError('This Git host has closed');
      const found = await setup(source);
      if (!found) throw new ConflictError('This Git host has closed');
      const { file, resource } = found,
        root = resource.root;
      let target: Awaited<ReturnType<typeof configuredUpstream>>;
      try {
        target = await configuredUpstream(await requireRepository(root));
      } catch (error) {
        if (error instanceof DataIntegrityError) throw error;
        throw new ConflictError(errorText(error), {
          hint: 'Configure the current Git upstream, then press Sync again.',
        });
      }
      const requestId = await coordinated(root, 'git.sync.manual-request', async () => {
        const current = await preferences(resource);
        if (!current.manualAvailable) throw new ConflictError('Git is Off or this Git host has closed');
        const state = (await readSyncState(file)) ?? initial(current.intervalSeconds);
        if (
          state.active &&
          (!syncProcessAlive(state.active.pid, state.active.host) ||
            (state.active.pid === process.pid && !jobs.has(file)))
        )
          interrupted(state);
        if (state.manual && !manualAlive(state.manual))
          cancelManual(state, 'Manual Sync requester interrupted; press Sync again');
        for (const [id, value] of Object.entries(state.receipts))
          if (value.finishedAt < Date.now() - 900_000) {
            delete state.receipts[id];
            manualOwners.delete(id);
          }
        if (state.active?.mode === 'rebase') {
          await writeSyncState(file, state);
          return state.active.id;
        }
        if (!state.manual) {
          if (Object.keys(state.receipts).length >= 1024)
            throw new ConflictError('Recent Sync results are full; retry after an earlier result expires');
          state.manual = {
            id: randomBytes(16).toString('hex'),
            pid: process.pid,
            host: localHost(),
            requestedAt: Date.now(),
            target,
          };
        }
        const requestId = state.manual.id;
        manualOwners.set(requestId, owner);
        await writeSyncState(file, state);
        return requestId;
      });
      void enqueue(file, resource);
      // Read this id's durable receipt. An older last result or an automatic merge cannot satisfy it.
      const until = Date.now() + 300_000;
      while (Date.now() < until) {
        const result = await coordinated(root, 'git.sync.manual-wait', async () => {
          const state = await readSyncState(file);
          if (!state)
            throw new ConflictError('Manual Sync result is unavailable; its push result is unknown', {
              details: { id: requestId },
            });
          if (state.active && !syncProcessAlive(state.active.pid, state.active.host)) interrupted(state);
          if (state.manual && !manualAlive(state.manual))
            cancelManual(state, 'Manual Sync requester interrupted; press Sync again');
          const result = Object.hasOwn(state.receipts, requestId) ? state.receipts[requestId] : undefined;
          // Local recovery can mark a dead admitted run, but never starts its network work again.
          if (result) await writeSyncState(file, state);
          if (!result && state.active?.id !== requestId && state.manual?.id !== requestId)
            throw new ConflictError('Manual Sync interrupted; its push result is unknown', {
              details: { id: requestId },
            });
          return result;
        });
        if (result) {
          manualOwners.delete(requestId);
          if (result.kind === 'synchronized' && result.pushed && result.commit && result.upstream)
            return {
              id: requestId,
              mode: 'rebase',
              commit: result.commit,
              upstream: result.upstream,
              evidence: result.evidence,
              repairs: result.repairs,
              pushed: true,
            };
          throw new ConflictError(result.message, {
            details: { ...result },
            hint: 'Resolve the reported cause, then run `rowbly git sync --rebase` again.',
          });
        }
        await new Promise<void>((resolve) => {
          const timer = setTimeout(resolve, 100);
          const job = jobs.get(file);
          if (job)
            void job.done.then(() => {
              clearTimeout(timer);
              resolve();
            });
        });
      }
      throw new ConflictError('Manual Sync is still pending or its push result is unknown', {
        details: { id: requestId },
        hint: 'Inspect Git status before starting a new Sync.',
      });
    },
  };
}
