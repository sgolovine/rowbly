import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { ConflictError } from "../errors/errors.js";
import { releaseFactoryOwnership } from "../factoryOwnership/factoryOwnership.js";
import { markReported, pendingReports, storyHash } from "../factoryPolicy/factoryPolicy.js";
import { getFactorySettings } from "../factorySettings/factorySettings.js";
import { readFactoryState, updateFactoryState } from "../factoryState/factoryState.js";
import { openFactorySession } from "../piRuntime/factorySession.js";
import { commitCanonicalProject } from "../projectWrite/projectWrite.js";
import { bundledSkills } from "../skill/skill.js";
import { searchStories } from "../story/story.js";
import { watchStories } from "../storyWatch/storyWatch.js";
import { promptHash, supervisorDigest } from "../supervisorDigest/supervisorDigest.js";
import { createThread, getThread, listThreads } from "../thread/thread.js";
import {
  changeThread,
  isActiveStatus,
  type ManagerState,
  notify,
  pauseForError,
  readAuthStamp,
  serial,
} from "./managerState.js";
import { classifiedStages, persistStatus, scan } from "./managerStatus.js";

type Delivery = Awaited<ReturnType<typeof buildDigest>>;

/** Runs the supervisor loop until the factory stops, then shuts the factory down. */
export async function runFactory(manager: ManagerState): Promise<void> {
  if (manager.stopping) {
    return;
  }

  if (manager.loopStarted) {
    throw new ConflictError("Factory loop is already running");
  }

  manager.loopStarted = true;
  manager.loopDone = new Promise<void>((resolve) => {
    manager.finishLoop = resolve;
  });

  try {
    await superviseUntilStopped(manager);
  } finally {
    manager.finishLoop();
    await shutdownFactory(manager);
  }
}

async function superviseUntilStopped(manager: ManagerState): Promise<void> {
  await openSupervisor(manager);

  manager.phase = "ready";
  manager.heartbeat = setInterval(() => {
    void serial(manager, () => persistStatus(manager)).catch(() => {});
  }, 5000);
  manager.heartbeat.unref();

  if (manager.stopping) {
    return;
  }

  manager.unwatch = await watchStories(() => notify(manager), manager.ctx, { includeState: false });
  manager.timer = setInterval(() => notify(manager), 30_000);
  manager.timer.unref();

  await serial(manager, () => persistStatus(manager));

  const contract = await readFile(join((await bundledSkills()).dir, "factory/references/supervisor-native.md"), "utf8");

  while (!manager.stopping) {
    if (!manager.dirty) {
      await waitForWake(manager);
      continue;
    }

    manager.dirty = false;

    try {
      await superviseOnce(manager, contract);
    } catch {
      if (!manager.stopping) {
        manager.attention.set("reconcile", { text: "Project reconciliation failed; retry on the next scan" });
        await serial(manager, () => persistStatus(manager)).catch(() => {});
      }
    }
  }
}

async function waitForWake(manager: ManagerState): Promise<void> {
  await new Promise<void>((resolve) => {
    manager.wake = resolve;

    if (manager.dirty || manager.stopping) {
      resolve();
    }
  });

  manager.wake = undefined;
}

/** Reconciles the Project, then sends a digest to the supervisor when the digest has new material. */
async function superviseOnce(manager: ManagerState, contract: string): Promise<void> {
  await reconcilePolicy(manager);
  await refreshSettings(manager);
  await clearProviderPauses(manager);
  await commitProject(manager);

  if (manager.stopping) {
    return;
  }

  const delivery = await buildDigest(manager);

  if (shouldSkipDigest(manager, delivery)) {
    await serial(manager, () => persistStatus(manager));
    return;
  }

  if (shouldRotateSupervisor(manager)) {
    await rotateSupervisor(manager);
  }

  await deliverDigest(manager, contract, delivery);

  if (manager.stopping) {
    return;
  }

  await serial(manager, () => persistStatus(manager));
}

/** Writes the current policy decisions to the factory state, and gives them back. */
export function reconcilePolicy(manager: ManagerState) {
  return serial(manager, async () => {
    const policy = await scan(manager);

    await updateFactoryState(manager.paths.root, () => policy.state, manager.ctx);

    return policy.decisions;
  });
}

async function refreshSettings(manager: ManagerState): Promise<void> {
  manager.settings = await getFactorySettings(manager.ctx).catch(() => manager.settings);
  manager.limit = manager.deps.maxWorkers ?? manager.settings.maxWorkers;
}

/** Clears authentication pauses after a credential change, and pauses whose retry time has passed. */
async function clearProviderPauses(manager: ManagerState): Promise<void> {
  const currentAuthStamp = await readAuthStamp(manager.deps.agentDir);

  if (currentAuthStamp !== manager.authStamp) {
    manager.authStamp = currentAuthStamp;

    for (const [provider, pause] of manager.providers) {
      if (pause.reason === "authentication") {
        manager.providers.delete(provider);
      }
    }
  }

  for (const [provider, pause] of manager.providers) {
    if (pause.retryAt && Date.parse(pause.retryAt) <= Date.now()) {
      manager.providers.delete(provider);
    }
  }
}

async function commitProject(manager: ManagerState): Promise<void> {
  const committed = await commitCanonicalProject(manager.paths.root);

  if (!["clean", "committed"].includes(committed.status)) {
    manager.attention.set("commit", { text: `Canonical commit: ${committed.status}` });
  }
}

/** Builds the bounded supervisor digest from the policy, the workers, the reports and the notes. */
async function buildDigest(manager: ManagerState) {
  const policy = await scan(manager);
  const state = await readFactoryState(manager.paths.root, manager.ctx);
  const stages = await classifiedStages(manager);
  const reports = pendingReports(state);
  const { threads } = await listThreads({}, manager.ctx);
  const stories = await searchStories({}, manager.ctx);

  const candidates = policy.decisions.filter((d) => ["start", "retry"].includes(d.action));
  const unclassified = stages.filter(
    (s) => s.enabled && s.promptClass === "unclassified" && stories.some((story) => story.stage === s.key),
  );
  const material = candidates.length > 0 || unclassified.length > 0 || reports.length > 0;

  const digest = supervisorDigest({
    settings: manager.settings,
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
    holds: [...manager.holds.entries()],
    providers: [...manager.providers.entries()],
    attention: [...manager.attention.entries()],
  });

  return { ...digest, reports: reports.slice(0, digest.deliveredCounts.reports ?? 0), material };
}

/** Skips a digest with no material, a paused supervisor provider, or a repeat before the backoff ends. */
function shouldSkipDigest(manager: ManagerState, delivery: Delivery): boolean {
  const supervisorProvider = manager.settings.supervisorModel?.provider ?? manager.supervisorChoice?.provider;
  const supervisorPaused = !!supervisorProvider && manager.providers.has(supervisorProvider);
  const repeated = delivery.hash === manager.attemptedHash && Date.now() < manager.nextWakeAt;

  return !delivery.material || supervisorPaused || repeated;
}

/** Opens a new supervisor session after a model change, many wakes, one day, or a half-full context. */
function shouldRotateSupervisor(manager: ManagerState): boolean {
  const { supervisorModel } = manager.settings;
  const modelChanged =
    !!supervisorModel && JSON.stringify(supervisorModel) !== JSON.stringify(manager.supervisorChoice);
  const contextPercent = manager.supervisor?.session.getContextUsage()?.percent ?? 0;

  return (
    modelChanged ||
    manager.wakeCount >= 50 ||
    Date.now() - manager.supervisorBorn >= 24 * 60 * 60_000 ||
    contextPercent > 50
  );
}

async function rotateSupervisor(manager: ManagerState): Promise<void> {
  await manager.supervisor?.close();

  const previous = manager.supervisorId;

  if (previous) {
    await serial(manager, () => changeThread(manager, previous, "completed"));
  }

  await openSupervisor(manager, previous);
}

async function deliverDigest(manager: ManagerState, contract: string, delivery: Delivery): Promise<void> {
  try {
    manager.attemptedHash = delivery.hash;
    manager.nextWakeAt = Date.now() + 60_000;
    await serial(manager, () => persistStatus(manager));

    const instructions = (await readFile(manager.paths.instructionsFile, "utf8").catch(() => "")).slice(0, 16_000);

    await manager.supervisor?.sendDigest(`${contract}\n${instructions}\n${delivery.text}`);

    manager.wakeCount++;
    manager.unanswered = manager.acknowledgedHash === delivery.hash ? manager.unanswered + 1 : 0;
    manager.acknowledgedHash = delivery.hash;
    manager.deliveredReportIds.push(...delivery.reports.map((r) => promptHash(JSON.stringify(r))));
    manager.deliveredReportIds.splice(0, Math.max(0, manager.deliveredReportIds.length - 100));

    await serial(manager, () =>
      updateFactoryState(
        manager.paths.root,
        (state) => delivery.reports.reduce((current, report) => markReported(current, report), state),
        manager.ctx,
      ),
    );

    manager.nextWakeAt = Date.now() + Math.min(30 * 60_000, 30_000 * 2 ** Math.min(manager.unanswered, 6));
  } catch (error) {
    if (!manager.stopping) {
      pauseForError(manager, manager.supervisorChoice?.provider, error);
      manager.attention.set("supervisor", { text: "Supervisor turn failed; retry after backoff" });
      manager.nextWakeAt = Date.now() + 60_000;
    }
  }
}

async function openSupervisor(manager: ManagerState, parentThreadId?: string): Promise<void> {
  const thread = await serial(manager, () =>
    createThread(
      { role: "supervisor", cwd: manager.paths.root, ownerToken: manager.owner.token, parentThreadId },
      manager.ctx,
    ),
  );

  manager.supervisorId = thread.id;

  const opened = await openFactorySession({
    thread,
    runtimeDir: manager.paths.runtimeDir,
    agentDir: manager.deps.agentDir,
    runtime: manager.deps.runtime,
    choice: manager.settings.supervisorModel,
    tools: manager.tools,
  });

  manager.supervisor = opened.handle;
  manager.supervisorChoice = opened.model;
  manager.deps.onModel?.("supervisor", opened.model);

  await serial(manager, () =>
    changeThread(manager, thread.id, "running", { model: opened.model, session: { id: thread.id, file: opened.file } }),
  );

  manager.supervisorBorn = Date.now();
  manager.wakeCount = 0;
}

/** Stops the factory one time. Later calls get the same task. */
export function shutdownFactory(manager: ManagerState): Promise<void> {
  manager.shutdownTask ??= stopFactory(manager);

  return manager.shutdownTask;
}

async function stopFactory(manager: ManagerState): Promise<void> {
  manager.stopping = true;
  manager.unwatch?.();
  clearInterval(manager.timer);
  clearInterval(manager.heartbeat);
  clearTimeout(manager.deadlineTimer);
  manager.phase = "stopping";
  manager.wake?.();

  const workers = [...manager.active.values()];

  await Promise.all([manager.supervisor?.session.abort(), ...workers.map((a) => a.session?.session.abort())]);
  await manager.loopDone;
  await Promise.all([...manager.active.values()].map((a) => a.task));
  await manager.supervisor?.close();

  await serial(manager, async () => {
    await interruptSupervisor(manager);
    manager.phase = "stopped";
    await persistStatus(manager);
  });

  await manager.deps.runtime.settleCredentialWrites();
  await releaseFactoryOwnership(manager.paths, manager.owner.token);
}

async function interruptSupervisor(manager: ManagerState): Promise<void> {
  if (!manager.supervisorId) {
    return;
  }

  const thread = await getThread(manager.supervisorId, manager.ctx);

  if (isActiveStatus(thread.status)) {
    await changeThread(manager, thread.id, "interrupted", { resumable: !!thread.session.file });
  }
}
