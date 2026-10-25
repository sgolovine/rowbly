import { randomBytes } from 'node:crypto';
import { join } from 'node:path';
import { isDeepStrictEqual } from 'node:util';
import { ConflictError, PluginError } from '../../core';
import type { DataRoot } from '../../schemas';
import { createRepositories } from '../../storage';
import { gitText } from '../../storage/gitProcess';
import { canonicalGitRoot, requireRepository, rootGitKey, withGitWorker } from '../../storage/gitRepository';
import { configuredUpstream, GitSyncPushError, type GitUpstream, synchronizeGit } from '../../storage/gitSync';
import {
  type GitSyncState,
  localHost,
  readSyncState,
  syncProcessAlive,
  writeSyncState,
} from '../../storage/gitSyncState';
import { coordinated, outsideCoordination } from '../coordination';
import { currentScope } from './executionScope';
import { mergeData } from './mergeData';
import type { AnyPluginDefinition } from './types';

export interface GitSyncOptions {
  enabled: boolean;
  intervalSeconds: number;
  authorName?: string;
  authorEmail?: string;
}
export type GitSyncOptionsSource = (localData: unknown) => GitSyncOptions;
export interface GitSyncStatus extends Partial<GitSyncState> {
  enabled: boolean;
  intervalSeconds: number;
  branch?: string;
  upstream?: string;
  prerequisite?: string;
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
interface ManualRequest {
  id: string;
  target: GitUpstream;
  result?: GitSyncState['last'];
}
const jobs = new Map<string, { root: string; done: Promise<void>; manual?: ManualRequest }>();
const disposed = new WeakSet<object>();
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
  return { version: 1, anchor, nextDue: anchor + intervalSeconds * 1000, intervalSeconds };
}
function errorText(err: unknown): string {
  return (err instanceof Error ? err.message : String(err))
    .replace(/(https?:\/\/)[^/\s@]+@/g, '$1[redacted]@')
    .slice(0, 2000);
}
async function preferences(resource: Resource): Promise<GitSyncOptions> {
  const repos = createRepositories(resource.root);
  const config = await repos.rootConfig.get();
  const options = resource.source((await repos.localState.get()).plugins?.[resource.id]);
  return {
    ...options,
    enabled:
      config.plugins?.[resource.id]?.enabled === true &&
      options.enabled &&
      !(resource.owner && disposed.has(resource.owner)),
  };
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
function enqueue(file: string, resource: Resource, manual?: ManualRequest): Promise<void> {
  const prior = jobs.get(file);
  if (prior) {
    if (!manual) return prior.done;
    // A scheduled merge cannot satisfy a manual rebase. Join a rebase, or wait then admit one.
    return prior.done.then(async () => {
      if (prior.manual && isDeepStrictEqual(prior.manual.target, manual.target)) manual.result = prior.manual.result;
      else await enqueue(file, resource, manual);
    });
  }
  const startedAt = Date.now();
  let admittedId: string | undefined;
  const done = outsideCoordination(async () => {
    const repo = await requireRepository(resource.root);
    await withGitWorker(repo, async () => {
      const target = await configuredUpstream(repo);
      if (manual && !isDeepStrictEqual(manual.target, target))
        throw new Error(
          'Git branch or upstream changed while manual Sync waited; run Sync again on the intended branch',
        );
      const admitted = await coordinated(resource.root, 'git.sync.admit', async () => {
        const current = await preferences(resource);
        const state = (await readSyncState(file)) ?? initial(current.intervalSeconds);
        clearTimeout(resource.timer);
        if (
          manual &&
          (await createRepositories(resource.root).rootConfig.get()).plugins?.[resource.id]?.enabled !== true
        )
          throw new Error('The Git Plugin is Off');
        if (manual && resource.owner && disposed.has(resource.owner)) throw new Error('This Git host has closed');
        if (!manual && !current.enabled) {
          delete state.requested;
          await writeSyncState(file, state);
          return null;
        }
        if (!manual && state.target && !isDeepStrictEqual(state.target, target)) {
          state.target = target;
          await writeSyncState(file, state);
          throw new Error('Git branch or upstream changed since scheduling; next interval uses the current branch');
        }
        state.target = target;
        if (state.intervalSeconds !== current.intervalSeconds) {
          state.intervalSeconds = current.intervalSeconds;
          state.nextDue = state.anchor + current.intervalSeconds * 1000;
        }
        if (state.active) {
          state.last = {
            kind: 'interrupted',
            message: 'Previous run interrupted; local recovery completed before admission',
            startedAt: state.active.startedAt,
            finishedAt: Date.now(),
            evidence: [],
            repairs: 0,
          };
          delete state.active;
        }
        if (!manual && !state.requested && state.nextDue > Date.now()) {
          await writeSyncState(file, state);
          arm(file, resource, state.nextDue);
          return null;
        }
        const active = {
          id: manual?.id ?? state.requested ?? randomBytes(8).toString('hex'),
          pid: process.pid,
          host: localHost(),
          startedAt: Date.now(),
          phase: 'admitted',
        };
        delete state.requested;
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
        const result = await synchronizeGit(
          repo,
          resource.root,
          { ...admitted.current, frequency: 'change' },
          (read) => coordinated(resource.root, 'git.sync.capture', read),
          (base, left, right) => mergeData(base, left, right, resource.registry),
          phase,
          async (files) => {
            mergeData(
              { id: 'validation', files },
              { id: 'validation', files },
              { id: 'validation', files },
              resource.registry,
            );
          },
          target,
          manual ? 'rebase' : 'merge',
        );
        last = {
          id: admitted.active.id,
          kind: 'synchronized',
          message: 'Synchronized with configured upstream',
          startedAt: admitted.active.startedAt,
          finishedAt: Date.now(),
          commit: result.commit,
          upstream: result.upstream,
          evidence: result.evidence,
          repairs: result.repairs,
        };
      } catch (err) {
        const commit = await gitText(repo.top, ['rev-parse', 'HEAD']).catch(() => undefined);
        last = {
          id: admitted.active.id,
          kind: 'failed',
          message: errorText(err),
          startedAt: admitted.active.startedAt,
          finishedAt: Date.now(),
          commit,
          evidence: err instanceof GitSyncPushError ? err.local.evidence : [],
          repairs: err instanceof GitSyncPushError ? err.local.repairs : 0,
          upstream: err instanceof GitSyncPushError ? err.local.upstream : undefined,
        };
      }
      if (manual) manual.result = last;
      await coordinated(resource.root, 'git.sync.finish', async () => {
        const live = resources.get(file) ?? resource;
        const current = await preferences(live),
          state = (await readSyncState(file)) ?? initial(current.intervalSeconds);
        if (state.active?.id !== admitted.active.id) throw new Error('Git synchronization completion identity changed');
        delete state.active;
        state.last = last;
        state.anchor = Date.now();
        state.intervalSeconds = current.intervalSeconds;
        state.nextDue = state.anchor + current.intervalSeconds * 1000;
        await writeSyncState(file, state);
        if (current.enabled) arm(file, live, state.nextDue);
      });
    });
  }).catch(async (err) => {
    if (manual)
      manual.result = {
        id: manual.id,
        kind: 'failed',
        message: errorText(err),
        startedAt,
        finishedAt: Date.now(),
        evidence: [],
        repairs: 0,
      };
    resource.warn(`Git synchronization: ${errorText(err)}`);
    const live = resources.get(file);
    if (!live) return;
    try {
      await coordinated(live.root, 'git.sync.failed', async () => {
        const current = await preferences(live);
        const state = (await readSyncState(file)) ?? initial(current.intervalSeconds);
        // Another process may have admitted a run while this worker was waiting.
        if (!state.active || state.active.id === admittedId) {
          delete state.active;
          delete state.requested;
          state.last = {
            kind: 'failed',
            message: errorText(err),
            startedAt,
            finishedAt: Date.now(),
            evidence: [],
            repairs: 0,
          };
          state.anchor = Date.now();
          state.intervalSeconds = current.intervalSeconds;
          state.nextDue = state.anchor + Math.max(1000, current.intervalSeconds * 1000);
          await writeSyncState(file, state);
        }
        if (current.enabled) arm(file, live, Math.max(Date.now() + 1000, state.nextDue));
      });
    } catch (failure) {
      // Recovery or storage can itself be unavailable. Retry admission after a bounded pause;
      // it still reads the latest enabled preference before starting any Git work.
      live.warn(`Git synchronization recovery: ${errorText(failure)}`);
      if (!(live.owner && disposed.has(live.owner))) arm(file, live, Date.now() + 30_000);
    }
  });
  jobs.set(file, { root: resource.root.path, done, manual });
  void done.finally(() => {
    if (jobs.get(file)?.done === done) jobs.delete(file);
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
        state.last = {
          kind: 'interrupted',
          message: 'Previous run interrupted; local recovery completed',
          startedAt: state.active.startedAt,
          finishedAt: Date.now(),
          evidence: [],
          repairs: 0,
        };
        delete state.active;
        await writeSyncState(file, state);
      }
      return { ...state, enabled: current.enabled, intervalSeconds: current.intervalSeconds };
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
          if (state?.requested) {
            delete state.requested;
            await writeSyncState(file, state);
          }
          return;
        }
        const state = (await readSyncState(file)) ?? initial(current.intervalSeconds);
        state.intervalSeconds = current.intervalSeconds;
        state.target = target;
        state.nextDue = state.anchor + current.intervalSeconds * 1000;
        await writeSyncState(file, state);
        if (state.nextDue <= Date.now() || state.requested) enqueue(file, resource);
        else arm(file, resource, state.nextDue);
      });
    },
    async requestSync(source: GitSyncOptionsSource, mode: 'merge' | 'rebase' = 'merge'): Promise<GitSyncStatus> {
      const scope = currentScope();
      if (scope && (!['command', 'screen'].includes(scope.stage) || scope.ended))
        throw new PluginError('Git synchronization can be requested only from a command or screen');
      if (owner && disposed.has(owner)) throw new Error('This Git host has closed');
      const found = await setup(source);
      if (!found) throw new Error('This Git host has closed');
      const { file, resource } = found;
      const root = resource.root;
      if (mode === 'rebase') {
        const target = await configuredUpstream(await requireRepository(root)).catch((cause: unknown) => {
          throw new ConflictError(errorText(cause), {
            hint: 'Check out the intended branch and configure its Git upstream, then run Sync again.',
            cause,
          });
        });
        const manual: ManualRequest = { id: randomBytes(8).toString('hex'), target };
        await enqueue(file, resource, manual);
        // Use this exact run's completion, never a possibly newer persisted last result.
        const result = manual.result;
        if (result?.kind !== 'synchronized')
          throw new ConflictError(result?.message ?? 'Sync did not complete', {
            hint: 'Local work is retained. Check the configured upstream, network and Git diagnostics; resolve any reported conflict, then run Sync again.',
          });
        return { ...(await status(source)), last: result };
      }
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
          delete state.active;
        if (state.active) return false;
        state.target = target;
        state.requested ??= randomBytes(8).toString('hex');
        await writeSyncState(file, state);
        return true;
      });
      if (request) await enqueue(file, resource);
      return status(source);
    },
  };
}
