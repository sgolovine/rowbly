import { ConflictError } from "../errors/errors.js";
import { markReported, pendingReports, storyHash } from "../factory-policy/factory-policy.js";
import { getFactorySettings } from "../factory-settings/factory-settings.js";
import { readFactoryState, updateFactoryState } from "../factory-state/factory-state.js";
import { supervisorMessage } from "../messages/messages.js";
import { openFactorySession } from "../pi-runtime/factory-session.js";
import { commitCanonicalProject } from "../project-write/project-write.js";
import { withEntry, withoutEntries } from "../store/store.js";
import { searchStories } from "../story/story.js";
import { watchStories } from "../story-watch/story-watch.js";
import { promptHash, supervisorDigest } from "../supervisor-digest/supervisor-digest.js";
import { createThread, listThreads } from "../thread/thread.js";
import { shutdownFactory } from "./factory-shutdown.js";
import {
  changeThread,
  getState,
  type Manager,
  type ManagerState,
  notify,
  pausedProviders,
  readAuthStamp,
  serial,
  setState,
} from "./manager-state.js";
import { classifiedStages, persistStatus, scan } from "./manager-status.js";
import { startProjectSync } from "./project-sync-step.js";
import { createSupervisorTools } from "./supervisor-tools.js";

type Delivery = Awaited<ReturnType<typeof buildDigest>>;

/** Runs the supervisor loop until the factory stops, then shuts the factory down. */
export async function runFactory(manager: Manager): Promise<void> {
  const { stopping, loopStarted } = getState(manager);

  if (stopping) {
    return;
  }

  if (loopStarted) {
    throw new ConflictError("Factory loop is already running");
  }

  const loopDone = new Promise<void>((resolve) => {
    setState(manager, () => ({ finishLoop: resolve }));
  });

  setState(manager, () => ({ loopStarted: true, loopDone }));

  try {
    await superviseUntilStopped(manager);
  } finally {
    getState(manager).finishLoop();
    await shutdownFactory(manager);
  }
}

async function superviseUntilStopped(manager: Manager): Promise<void> {
  await openSupervisor(manager);

  const heartbeat = setInterval(() => {
    void serial(manager, () => persistStatus(manager)).catch(() => {});
  }, 5000);

  heartbeat.unref();
  setState(manager, () => ({ phase: "ready", heartbeat }));

  if (getState(manager).stopping) {
    return;
  }

  const unwatch = await watchStories(() => notify(manager), manager.ctx, { includeState: false });
  const timer = setInterval(() => notify(manager), 30_000);

  timer.unref();
  setState(manager, () => ({ unwatch, timer }));

  await serial(manager, () => persistStatus(manager));

  while (!getState(manager).stopping) {
    if (!getState(manager).dirty) {
      await waitForWake(manager);
      continue;
    }

    setState(manager, () => ({ dirty: false }));

    try {
      await superviseOnce(manager);
    } catch {
      await recordReconcileFailure(manager);
    }
  }
}

async function waitForWake(manager: Manager): Promise<void> {
  await new Promise<void>((resolve) => {
    const { dirty, stopping } = setState(manager, () => ({ wake: resolve }));

    if (dirty || stopping) {
      resolve();
    }
  });

  setState(manager, () => ({ wake: undefined }));
}

async function recordReconcileFailure(manager: Manager): Promise<void> {
  if (getState(manager).stopping) {
    return;
  }

  const text = "Project reconciliation failed; retry on the next scan";

  setState(manager, (state) => ({ attention: withEntry(state.attention, "reconcile", { text }) }));
  await serial(manager, () => persistStatus(manager)).catch(() => {});
}

/** Reconciles the Project, then sends a digest to the supervisor when the digest has new material. */
async function superviseOnce(manager: Manager): Promise<void> {
  await reconcilePolicy(manager);
  await refreshSettings(manager);
  await clearProviderPauses(manager);
  await commitProject(manager);
  startProjectSync(manager);

  if (getState(manager).stopping) {
    return;
  }

  const delivery = await buildDigest(manager);

  if (shouldSkipDigest(getState(manager), delivery)) {
    await serial(manager, () => persistStatus(manager));
    return;
  }

  if (shouldRotateSupervisor(getState(manager))) {
    await rotateSupervisor(manager);
  }

  await deliverDigest(manager, delivery);

  if (getState(manager).stopping) {
    return;
  }

  await serial(manager, () => persistStatus(manager));
}

/** Writes the current policy decisions to the factory state, and gives them back. */
export function reconcilePolicy(manager: Manager) {
  return serial(manager, async () => {
    const policy = await scan(manager);

    await updateFactoryState(manager.paths.root, () => policy.state, manager.ctx);

    return policy.decisions;
  });
}

async function refreshSettings(manager: Manager): Promise<void> {
  const settings = await getFactorySettings(manager.ctx).catch(() => getState(manager).settings);

  setState(manager, () => ({ settings, limit: manager.deps.maxWorkers ?? settings.maxWorkers }));
}

/** Clears authentication pauses after a credential change, and pauses whose retry time has passed. */
async function clearProviderPauses(manager: Manager): Promise<void> {
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
}

/** Commits the canonical files. A running sync holds the write lock, so the commit waits for the next scan. */
async function commitProject(manager: Manager): Promise<void> {
  if (getState(manager).syncTask) {
    return;
  }

  const committed = await commitCanonicalProject(manager.paths.root, getState(manager).settings.git);

  if (["clean", "committed"].includes(committed.status)) {
    return;
  }

  const text = `Canonical commit: ${committed.status}`;

  setState(manager, (state) => ({ attention: withEntry(state.attention, "commit", { text }) }));
}

/** Builds the bounded supervisor digest from the policy, the workers, the reports and the notes. */
async function buildDigest(manager: Manager) {
  const policy = await scan(manager);
  const state = await readFactoryState(manager.paths.root, manager.ctx);
  const stages = await classifiedStages(manager);
  const reports = pendingReports(state);
  const { threads } = await listThreads({}, manager.ctx);
  const stories = await searchStories({}, manager.ctx);

  const { settings, holds, providers, attention } = getState(manager);
  const candidates = policy.decisions.filter((d) => ["start", "retry"].includes(d.action));
  const unclassified = stages.filter(
    (s) => s.enabled && s.promptClass === "unclassified" && stories.some((story) => story.stage === s.key),
  );
  const material = candidates.length > 0 || unclassified.length > 0 || reports.length > 0;

  const digest = supervisorDigest({
    settings,
    candidates: candidates.map((candidate) => {
      const story = stories.find((s) => s.id === candidate.story);

      return { ...candidate, hash: story ? storyHash(story) : undefined };
    }),
    unclassified: unclassified.map((s) => ({ stage: s.key, promptHash: s.promptHash })),
    workers: threads
      .filter((t) => t.role === "worker")
      .map((t) => ({
        id: t.id,
        storyId: t.storyId,
        stage: t.stage,
        status: t.status,
        result: t.result ? { ...t.result, summary: t.result.summary.slice(0, 1000) } : undefined,
      })),
    reports: reports.map((report) => ({
      ...report,
      result: report.result === undefined ? undefined : JSON.stringify(report.result).slice(0, 1000),
    })),
    notes: state.notes ?? [],
    holds: [...holds.entries()],
    providers: [...providers.entries()],
    attention: [...attention.entries()],
  });

  return { ...digest, reports: reports.slice(0, digest.deliveredCounts.reports ?? 0), material };
}

/** Skips a digest with no material, a paused supervisor provider, or a repeat before the backoff ends. */
function shouldSkipDigest(state: Readonly<ManagerState>, delivery: Delivery): boolean {
  const supervisorProvider = state.settings.supervisorModel?.provider ?? state.supervisorChoice?.provider;
  const supervisorPaused = !!supervisorProvider && state.providers.has(supervisorProvider);
  const repeated = delivery.hash === state.attemptedHash && Date.now() < state.nextWakeAt;

  return !delivery.material || supervisorPaused || repeated;
}

/** Opens a new supervisor session after a model change, many wakes, one day, or a half-full context. */
function shouldRotateSupervisor(state: Readonly<ManagerState>): boolean {
  const { supervisorModel } = state.settings;
  const modelChanged = !!supervisorModel && JSON.stringify(supervisorModel) !== JSON.stringify(state.supervisorChoice);
  const contextPercent = state.supervisor?.session.getContextUsage()?.percent ?? 0;

  return (
    modelChanged ||
    state.wakeCount >= 50 ||
    Date.now() - state.supervisorBorn >= 24 * 60 * 60_000 ||
    contextPercent > 50
  );
}

async function rotateSupervisor(manager: Manager): Promise<void> {
  await getState(manager).supervisor?.close();

  const previous = getState(manager).supervisorId;

  if (previous) {
    await serial(manager, () => changeThread(manager, previous, "completed"));
  }

  await openSupervisor(manager, previous);
}

async function deliverDigest(manager: Manager, delivery: Delivery): Promise<void> {
  try {
    await sendDigest(manager, delivery);
  } catch (error) {
    if (getState(manager).stopping) {
      return;
    }

    const text = "Supervisor turn failed; retry after backoff";

    setState(manager, (state) => ({
      providers: pausedProviders(state.providers, state.supervisorChoice?.provider, error),
      attention: withEntry(state.attention, "supervisor", { text }),
      nextWakeAt: Date.now() + 60_000,
    }));
  }
}

/** Sends the digest, records the delivered reports, and sets the next wake with a backoff. */
async function sendDigest(manager: Manager, delivery: Delivery): Promise<void> {
  setState(manager, () => ({ attemptedHash: delivery.hash, nextWakeAt: Date.now() + 60_000 }));
  await serial(manager, () => persistStatus(manager));

  await getState(manager).supervisor?.sendDigest(await supervisorMessage(manager.paths, delivery.text));

  const reportIds = delivery.reports.map((r) => promptHash(JSON.stringify(r)));

  const { unanswered } = setState(manager, (state) => ({
    wakeCount: state.wakeCount + 1,
    unanswered: state.acknowledgedHash === delivery.hash ? state.unanswered + 1 : 0,
    acknowledgedHash: delivery.hash,
    deliveredReportIds: [...state.deliveredReportIds, ...reportIds].slice(-100),
  }));

  await serial(manager, () =>
    updateFactoryState(
      manager.paths.root,
      (state) => delivery.reports.reduce((current, report) => markReported(current, report), state),
      manager.ctx,
    ),
  );

  setState(manager, () => ({
    nextWakeAt: Date.now() + Math.min(30 * 60_000, 30_000 * 2 ** Math.min(unanswered, 6)),
  }));
}

async function openSupervisor(manager: Manager, parentThreadId?: string): Promise<void> {
  const thread = await serial(manager, () =>
    createThread(
      { role: "supervisor", cwd: manager.paths.root, ownerToken: manager.owner.token, parentThreadId },
      manager.ctx,
    ),
  );

  setState(manager, () => ({ supervisorId: thread.id }));

  const opened = await openFactorySession({
    thread,
    runtimeDir: manager.paths.runtimeDir,
    agentDir: manager.deps.agentDir,
    runtime: manager.deps.runtime,
    choice: getState(manager).settings.supervisorModel,
    tools: createSupervisorTools(manager),
  });

  setState(manager, () => ({ supervisor: opened.handle, supervisorChoice: opened.model }));
  manager.deps.onModel?.("supervisor", opened.model);

  await serial(manager, () =>
    changeThread(manager, thread.id, "running", { model: opened.model, session: { id: thread.id, file: opened.file } }),
  );

  setState(manager, () => ({ supervisorBorn: Date.now(), wakeCount: 0 }));
}
