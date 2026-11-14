import { type GitSettings, gitSettings } from "../factory-settings/factory-settings.js";
import { type SyncResult, type SyncStep, syncCanonicalProject } from "../project-sync/project-sync.js";
import { withEntry, withoutEntry } from "../store/store.js";
import { type Attention, getState, type Manager, type ManagerState, serial, setState } from "./manager-state.js";
import { persistStatus } from "./manager-status.js";

const ATTENTION_LIMIT = 500;

/** Tells if a sync must start: sync is on, no sync runs, and the interval of the current settings has passed. */
export function isSyncDue(state: Readonly<ManagerState>, now: number): boolean {
  const git = gitSettings(state.settings);

  return (
    !state.stopping &&
    !state.syncTask &&
    (git.push || git.pull) &&
    now >= state.lastSyncAt + git.syncIntervalSeconds * 1000
  );
}

/**
 * Starts one Git sync of the canonical checkout when it is due. The sync runs outside `serial`,
 * because a network command can take minutes and must not stop the reconcile.
 */
export function startProjectSync(manager: Manager): void {
  if (!isSyncDue(getState(manager), Date.now())) {
    return;
  }

  const git = gitSettings(getState(manager).settings);
  const task = runSync(manager, git);

  setState(manager, () => ({ lastSyncAt: Date.now(), syncTask: task }));
}

async function runSync(manager: Manager, git: GitSettings): Promise<void> {
  // The sync must not start in the same tick, because the caller records the task first.
  await Promise.resolve();

  try {
    const result = await syncCanonicalProject(manager.paths.root, { push: git.push, pull: git.pull });

    await recordSync(manager, result);
  } finally {
    setState(manager, () => ({ syncTask: undefined }));
  }
}

/** Sets or removes the attention entry of one step. A step that is off changes nothing. */
function withStep(
  attention: ReadonlyMap<string, Attention>,
  key: "push" | "pull",
  step: SyncStep | undefined,
): ReadonlyMap<string, Attention> {
  if (!step) {
    return attention;
  }

  if (step.status === "failed") {
    const text = `Git ${key} failed: ${step.detail ?? "unknown error"}`.slice(0, ATTENTION_LIMIT);

    return withEntry(attention, key, { text });
  }

  return withoutEntry(attention, key);
}

/** Writes the attention entries of the sync, then the status file. A failure does not stop the factory. */
async function recordSync(manager: Manager, result: SyncResult): Promise<void> {
  setState(manager, (state) => ({
    attention: withStep(withStep(state.attention, "pull", result.pull), "push", result.push),
  }));

  if (getState(manager).stopping) {
    return;
  }

  await serial(manager, () => persistStatus(manager)).catch(() => {});
}
