import { getFactorySettings } from "../factory-settings/factory-settings.js";
import { commitCanonicalProject } from "../project-write/project-write.js";
import { withEntry, withoutEntries, withoutEntry } from "../store/store.js";
import { getState, type Manager, readAuthStamp, setState } from "./manager-state.js";
import { startProjectSync } from "./project-sync-step.js";

const ATTENTION_LIMIT = 500;

/** The result of one step: an attention text for a problem, `undefined` for no problem, or `keep` for no change. */
type StepResult = string | undefined | "keep";

/** Gives the message of an error. */
export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** Makes an attention text with the error message, limited to 500 characters. */
export function failureText(label: string, error: unknown): string {
  return `${label}: ${errorMessage(error)}`.slice(0, ATTENTION_LIMIT);
}

/**
 * Runs the steps of a pass that the digest does not need. A failure in one step records an attention
 * entry, and the pass continues. A step without a problem removes its entry.
 */
export async function runSideSteps(manager: Manager): Promise<void> {
  await runStep(manager, "settings", "Factory settings refresh failed", () => refreshSettings(manager));
  await runStep(manager, "providers", "Provider pause check failed", () => clearProviderPauses(manager));
  await runStep(manager, "commit", "Canonical commit failed", () => commitProject(manager));
  await runStep(manager, "sync", "Git sync start failed", () => startSync(manager));
}

async function runStep(manager: Manager, key: string, label: string, step: () => Promise<StepResult>): Promise<void> {
  const result = await attempt(label, step);

  if (result === "keep") {
    return;
  }

  setState(manager, (state) => ({
    attention: result ? withEntry(state.attention, key, { text: result }) : withoutEntry(state.attention, key),
  }));
}

/** Runs one step, and gives the attention text of a failure. A synchronous throw is also a failure. */
async function attempt(label: string, step: () => Promise<StepResult>): Promise<StepResult> {
  try {
    return await step();
  } catch (error) {
    return failureText(label, error);
  }
}

/** Reads the factory settings again. A failed read keeps the current settings. */
async function refreshSettings(manager: Manager): Promise<StepResult> {
  const read = await getFactorySettings(manager.ctx).then(
    (settings) => ({ settings, problem: undefined }),
    (error: unknown) => ({
      settings: getState(manager).settings,
      problem: failureText("Factory settings refresh failed", error),
    }),
  );

  setState(manager, () => ({
    settings: read.settings,
    limit: manager.deps.maxWorkers ?? read.settings.maxWorkers,
  }));

  return read.problem;
}

/** Clears authentication pauses after a credential change, and pauses whose retry time has passed. */
async function clearProviderPauses(manager: Manager): Promise<StepResult> {
  const authStamp = await readAuthStamp(manager.deps.agentDir);

  setState(manager, (state) => {
    const credentialsChanged = authStamp !== state.authStamp;
    const providers = withoutEntries(
      state.providers,
      (pause) =>
        (credentialsChanged && pause.reason === "authentication") ||
        (!!pause.retryAt && Date.parse(pause.retryAt) <= Date.now()),
    );

    return { authStamp, providers };
  });

  return undefined;
}

/** Commits the canonical files. A running sync holds the write lock, so the commit waits for the next scan. */
async function commitProject(manager: Manager): Promise<StepResult> {
  if (getState(manager).syncTask) {
    return "keep";
  }

  const committed = await commitCanonicalProject(manager.paths.root, getState(manager).settings.git);

  if (["clean", "committed"].includes(committed.status)) {
    return undefined;
  }

  return `Canonical commit: ${committed.status}`;
}

/** Starts a Git sync when it is due. The sync records its own `push` and `pull` entries. */
function startSync(manager: Manager): Promise<StepResult> {
  startProjectSync(manager);

  return Promise.resolve(undefined);
}
