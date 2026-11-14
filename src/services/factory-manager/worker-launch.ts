import { cancelThreadChecks } from "../check-queue/check-queue.js";
import { ConflictError } from "../errors/errors.js";
import type { ModelChoice } from "../factory-settings/factory-settings.js";
import { createResultTool } from "../factory-worker/factory-worker.js";
import { workerMessage } from "../messages/messages.js";
import { openFactorySession } from "../pi-runtime/factory-session.js";
import type { PiSession } from "../pi-runtime/pi-runtime.js";
import { projectWrite, projectWriteLockPath } from "../project-write/project-write.js";
import { listStages } from "../stage/stage.js";
import { Store, withEntry, withoutEntry } from "../store/store.js";
import { getStory, type Story, updateStory } from "../story/story.js";
import { promptHash } from "../supervisor-digest/supervisor-digest.js";
import { getThread, type ThreadRecord, type WorkerResult } from "../thread/thread.js";
import { prepareWorkerWorktree } from "../worker-worktree/worker-worktree.js";
import {
  changeThread,
  getState,
  isActiveStatus,
  isProviderPaused,
  type Manager,
  type ManagerState,
  notify,
  pausedProviders,
  serial,
  setState,
} from "./manager-state.js";
import { persistStatus } from "./manager-status.js";
import { configuredChecks, workerChecks } from "./worker-checks.js";

type WorkerWorktree = Awaited<ReturnType<typeof prepareWorkerWorktree>>;
type OpenedSession = Awaited<ReturnType<typeof openFactorySession>>;
type SessionEvent = Parameters<Parameters<PiSession["session"]["subscribe"]>[0]>[0];

/** The state of one worker launch, from the reservation to the close of its session. */
interface WorkerRun {
  readonly id: string;
  readonly handle?: PiSession;
  readonly reportedResult?: WorkerResult;
  readonly assignedProvider?: string;
  readonly lastActivityAt: string;
  readonly lastTool?: string;
  readonly unsubscribe?: () => void;
  readonly activityTimer?: NodeJS.Timeout;
  readonly activityWritePending: boolean;
}

type RunStore = Store<WorkerRun>;

/** Prepares, prompts and finishes one reserved worker Thread. */
export async function launchWorker(manager: Manager, id: string): Promise<void> {
  const run = new Store<WorkerRun>({ id, lastActivityAt: new Date().toISOString(), activityWritePending: false });

  try {
    await runWorker(manager, run);
  } catch (error) {
    await failWorker(manager, run.current, error);
  } finally {
    await finishWorker(manager, run.current);
  }
}

async function runWorker(manager: Manager, run: RunStore): Promise<void> {
  const { id } = run.current;
  const intent = await getThread(id, manager.ctx);

  await manager.deps.beforeLaunch?.(intent);

  if ((await getThread(id, manager.ctx)).status !== "pending") {
    return;
  }

  if (getState(manager).stopping) {
    throw new ConflictError("Factory is stopping");
  }

  const story = await getStory({ id: intent.storyId as string }, manager.ctx);

  if (story.stage !== intent.stage) {
    throw new ConflictError("Story Stage changed before launch");
  }

  const worktree = await prepareWorkerWorktree(
    manager.paths.root,
    intent.runs.length > 1 ? { ...story, fields: { ...story.fields, worktree: intent.worktree ?? null } } : story,
  );

  await serial(manager, () => assignWorktree(manager, id, intent, story.id, worktree));

  const opened = await openWorkerSession(manager, run, intent, worktree.path);

  await serial(manager, () => startWorkerRun(manager, id, intent, story.id, opened));

  const prompt = await buildWorkerPrompt(manager, id, intent, story, worktree.path, opened.model);

  trackWorkerActivity(manager, run, opened.handle);
  await opened.handle.prompt(prompt);

  const result = await collectWorkerResult(manager, run, opened.handle);

  await serial(manager, () => completeWorker(manager, id, intent, story.id, result));
}

async function assignWorktree(
  manager: Manager,
  id: string,
  intent: ThreadRecord,
  storyId: string,
  worktree: WorkerWorktree,
): Promise<void> {
  if (getState(manager).stopping) {
    throw new ConflictError("Factory is stopping");
  }

  const fresh = await getStory({ id: storyId }, manager.ctx);

  if (fresh.stage !== intent.stage) {
    throw new ConflictError("Story Stage changed before launch");
  }

  await changeThread(manager, id, "pending", { cwd: worktree.path, worktree: worktree.path, branch: worktree.branch });

  if ("worktree" in fresh.fields) {
    await projectWrite(manager.paths.root, () =>
      updateStory({ id: storyId, fields: { worktree: worktree.path } }, manager.ctx),
    );
  }
}

async function openWorkerSession(
  manager: Manager,
  run: RunStore,
  intent: ThreadRecord,
  worktreePath: string,
): Promise<OpenedSession> {
  const resultTool = createResultTool((result) => serial(manager, () => recordResult(manager, run, result)));
  const checks = workerChecks(manager, intent, worktreePath);
  const opened = await openFactorySession({
    thread: intent,
    runtimeDir: manager.paths.runtimeDir,
    runtime: manager.deps.runtime,
    agentDir: manager.deps.agentDir,
    choice: intent.model ?? getState(manager).settings.workerModel,
    worker: { cwd: worktreePath, root: manager.paths.root, shim: manager.deps.shim, checks: checks.checks },
    tools: [resultTool, ...checks.tools],
  });

  run.update(() => ({ handle: opened.handle, assignedProvider: opened.model.provider }));
  setState(manager, (state) => attachSession(state.active, run.current.id, opened.handle));
  manager.deps.onModel?.("worker", opened.model);

  return opened;
}

/** Gives the active workers with the session on the entry of the Thread, if the entry is still there. */
function attachSession(active: ManagerState["active"], id: string, session: PiSession): Partial<ManagerState> {
  const entry = active.get(id);

  if (!entry) {
    return {};
  }

  return { active: withEntry(active, id, { ...entry, session }) };
}

async function recordResult(manager: Manager, run: RunStore, result: WorkerResult): Promise<void> {
  await changeThread(manager, run.current.id, "running", { result });
  run.update(() => ({ reportedResult: result }));
}

async function startWorkerRun(
  manager: Manager,
  id: string,
  intent: ThreadRecord,
  storyId: string,
  opened: OpenedSession,
): Promise<void> {
  if (getState(manager).stopping) {
    throw new ConflictError("Factory is stopping");
  }

  if (isProviderPaused(manager, opened.model.provider)) {
    throw new ConflictError("Worker provider is paused");
  }

  if ((await getStory({ id: storyId }, manager.ctx)).stage !== intent.stage) {
    throw new ConflictError("Story Stage changed before prompt");
  }

  await changeThread(manager, id, "running", { model: opened.model, session: { id, file: opened.file } });
}

async function buildWorkerPrompt(
  manager: Manager,
  id: string,
  intent: ThreadRecord,
  story: Story,
  worktreePath: string,
  model: ModelChoice,
): Promise<string> {
  const stage = (await listStages(manager.ctx)).find((s) => s.key === intent.stage);

  if (stage && getState(manager).promptClaims.get(id) !== promptHash(stage.prompt)) {
    throw new ConflictError("Stage prompt changed before launch");
  }

  if (!stage?.enabled) {
    throw new ConflictError("Stage is disabled");
  }

  const { root } = manager.paths;

  return workerMessage(manager.paths, {
    story: story.id,
    stage: story.stage,
    stagePrompt: stage.prompt,
    root,
    worktree: worktreePath,
    model: `${model.provider}/${model.modelId}`,
    shim: manager.deps.shim,
    lock: await projectWriteLockPath(root),
    checks: configuredChecks(manager).map((c) => ({ key: c.key, label: c.label, narrow: !!c.narrowCommand })),
  });
}

function trackWorkerActivity(manager: Manager, run: RunStore, handle: PiSession): void {
  const unsubscribe = handle.session.subscribe((event) => recordActivity(run, event));
  const activityTimer = setInterval(() => writeActivity(manager, run), 1000);

  activityTimer.unref();
  run.update(() => ({ unsubscribe, activityTimer }));
}

function recordActivity(run: RunStore, event: SessionEvent): void {
  const lastActivityAt = new Date().toISOString();

  if (event.type === "tool_execution_start") {
    run.update(() => ({ lastActivityAt, lastTool: event.toolName }));
    return;
  }

  run.update(() => ({ lastActivityAt }));
}

/** Writes the activity of a worker, but never queues a second write while one is pending. */
function writeActivity(manager: Manager, run: RunStore): void {
  if (run.current.activityWritePending) {
    return;
  }

  run.update(() => ({ activityWritePending: true }));

  void serial(manager, () => persistActivity(manager, run.current))
    .catch(() => {})
    .finally(() => run.update(() => ({ activityWritePending: false })));
}

async function persistActivity(manager: Manager, run: WorkerRun): Promise<void> {
  if (!run.handle) {
    return;
  }

  const thread = await getThread(run.id, manager.ctx);

  if (!isActiveStatus(thread.status)) {
    return;
  }

  const stats = run.handle.session.getSessionStats();

  await changeThread(manager, run.id, thread.status, {
    lastActivityAt: run.lastActivityAt,
    lastTool: run.lastTool,
    usage: { ...stats.tokens, cost: stats.cost },
  });
}

/** Takes the reported result, or a RESULT line, or asks the worker one more time to report. */
async function collectWorkerResult(
  manager: Manager,
  run: RunStore,
  handle: PiSession,
): Promise<WorkerResult | undefined> {
  if (run.current.reportedResult || getState(manager).stopping) {
    return run.current.reportedResult;
  }

  const fallback = handle.session.getLastAssistantText()?.match(/RESULT:\s*([^\n]+)\s*$/)?.[1];

  if (fallback) {
    return { outcome: fallback, summary: fallback.slice(0, 1000), blockers: [], problems: [] };
  }

  await handle.prompt("Call report_result now with the final outcome, summary, blockers and problems. Then stop.");

  return run.current.reportedResult;
}

async function completeWorker(
  manager: Manager,
  id: string,
  intent: ThreadRecord,
  storyId: string,
  reported: WorkerResult | undefined,
): Promise<void> {
  if (["interrupted", "cancelled"].includes((await getThread(id, manager.ctx)).status)) {
    return;
  }

  const fresh = await getStory({ id: storyId }, manager.ctx).catch(() => undefined);
  const result = reported ?? {
    outcome: "unknown",
    summary: "Worker stopped without a result",
    blockers: [],
    problems: [],
  };
  const problems =
    fresh?.stage === intent.stage
      ? [...result.problems.slice(0, 9), "Story remains in the assigned Stage"]
      : result.problems;
  const { stopping } = getState(manager);

  await changeThread(manager, id, stopping ? "interrupted" : "completed", {
    result: { ...result, problems },
    resumable: stopping,
  });
}

async function failWorker(manager: Manager, run: WorkerRun, error: unknown): Promise<void> {
  await serial(manager, async () => {
    setState(manager, (state) => ({ providers: pausedProviders(state.providers, run.assignedProvider, error) }));

    const thread = await getThread(run.id, manager.ctx);

    if (!isActiveStatus(thread.status)) {
      return;
    }

    await changeThread(manager, run.id, getState(manager).stopping ? "interrupted" : "failed", {
      resumable: !!thread.session.file,
      error: {
        class: run.handle ? "unknown" : "launch",
        code: "WORKER_FAILED",
        message: (error instanceof Error ? error.message : "Worker failed").slice(0, 1000),
      },
    });
  });
}

/** Stops the activity tracking, writes the final usage, closes the session and frees the slot. */
async function finishWorker(manager: Manager, run: WorkerRun): Promise<void> {
  clearInterval(run.activityTimer);
  run.unsubscribe?.();
  await cancelThreadChecks(manager.checks, run.id);

  if (run.handle) {
    const stats = run.handle.session.getSessionStats();

    await serial(manager, async () => {
      const thread = await getThread(run.id, manager.ctx);

      await changeThread(manager, run.id, thread.status, {
        lastActivityAt: run.lastActivityAt,
        lastTool: run.lastTool,
        usage: {
          input: stats.tokens.input,
          output: stats.tokens.output,
          cacheRead: stats.tokens.cacheRead,
          cacheWrite: stats.tokens.cacheWrite,
          cost: stats.cost,
        },
      });
    });
  }

  await run.handle?.close();
  await serial(manager, async () => {
    setState(manager, (state) => ({ active: withoutEntry(state.active, run.id) }));
    await persistStatus(manager);
  });
  notify(manager);
}
