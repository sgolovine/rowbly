import { ConflictError } from "../errors/errors.js";
import type { ModelChoice } from "../factorySettings/factorySettings.js";
import { createResultTool, workerMessage } from "../factoryWorker/factoryWorker.js";
import { openFactorySession } from "../piRuntime/factorySession.js";
import type { PiSession } from "../piRuntime/piRuntime.js";
import { projectWrite } from "../projectWrite/projectWrite.js";
import { listStages } from "../stage/stage.js";
import { getStory, type Story, updateStory } from "../story/story.js";
import { promptHash } from "../supervisorDigest/supervisorDigest.js";
import { getThread, type ThreadRecord, type WorkerResult } from "../thread/thread.js";
import { prepareWorkerWorktree } from "../workerWorktree/workerWorktree.js";
import {
  changeThread,
  isActiveStatus,
  isProviderPaused,
  type ManagerState,
  notify,
  pauseForError,
  serial,
} from "./managerState.js";
import { persistStatus } from "./managerStatus.js";

type WorkerWorktree = Awaited<ReturnType<typeof prepareWorkerWorktree>>;
type OpenedSession = Awaited<ReturnType<typeof openFactorySession>>;
type SessionEvent = Parameters<Parameters<PiSession["session"]["subscribe"]>[0]>[0];

/** The state of one worker launch, from the reservation to the close of its session. */
interface WorkerRun {
  id: string;
  handle?: PiSession;
  reportedResult?: WorkerResult;
  assignedProvider?: string;
  lastActivityAt: string;
  lastTool?: string;
  unsubscribe?: () => void;
  activityTimer?: NodeJS.Timeout;
  activityWritePending: boolean;
}

/** Prepares, prompts and finishes one reserved worker Thread. */
export async function launchWorker(manager: ManagerState, id: string): Promise<void> {
  const run: WorkerRun = { id, lastActivityAt: new Date().toISOString(), activityWritePending: false };

  try {
    await runWorker(manager, run);
  } catch (error) {
    await failWorker(manager, run, error);
  } finally {
    await finishWorker(manager, run);
  }
}

async function runWorker(manager: ManagerState, run: WorkerRun): Promise<void> {
  const intent = await getThread(run.id, manager.ctx);

  await manager.deps.beforeLaunch?.(intent);

  if ((await getThread(run.id, manager.ctx)).status !== "pending") {
    return;
  }

  if (manager.stopping) {
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

  await serial(manager, () => assignWorktree(manager, run.id, intent, story.id, worktree));

  const opened = await openWorkerSession(manager, run, intent, worktree.path);

  await serial(manager, () => startWorkerRun(manager, run.id, intent, story.id, opened));

  const prompt = await buildWorkerPrompt(manager, run.id, intent, story, worktree.path, opened.model);

  trackWorkerActivity(manager, run, opened.handle);
  await opened.handle.prompt(prompt);

  const result = await collectWorkerResult(manager, run, opened.handle);

  await serial(manager, () => completeWorker(manager, run.id, intent, story.id, result));
}

async function assignWorktree(
  manager: ManagerState,
  id: string,
  intent: ThreadRecord,
  storyId: string,
  worktree: WorkerWorktree,
): Promise<void> {
  if (manager.stopping) {
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
  manager: ManagerState,
  run: WorkerRun,
  intent: ThreadRecord,
  worktreePath: string,
): Promise<OpenedSession> {
  const resultTool = createResultTool((result) => serial(manager, () => recordResult(manager, run, result)));
  const opened = await openFactorySession({
    thread: intent,
    runtimeDir: manager.paths.runtimeDir,
    runtime: manager.deps.runtime,
    agentDir: manager.deps.agentDir,
    choice: intent.model ?? manager.settings.workerModel,
    worker: { cwd: worktreePath, root: manager.paths.root, shim: manager.deps.shim },
    tools: [resultTool],
  });
  const entry = manager.active.get(run.id);

  run.handle = opened.handle;
  run.assignedProvider = opened.model.provider;

  if (entry) {
    entry.session = opened.handle;
  }

  manager.deps.onModel?.("worker", opened.model);

  return opened;
}

async function recordResult(manager: ManagerState, run: WorkerRun, result: WorkerResult): Promise<void> {
  await changeThread(manager, run.id, "running", { result });
  run.reportedResult = result;
}

async function startWorkerRun(
  manager: ManagerState,
  id: string,
  intent: ThreadRecord,
  storyId: string,
  opened: OpenedSession,
): Promise<void> {
  if (manager.stopping) {
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
  manager: ManagerState,
  id: string,
  intent: ThreadRecord,
  story: Story,
  worktreePath: string,
  model: ModelChoice,
): Promise<string> {
  const stage = (await listStages(manager.ctx)).find((s) => s.key === intent.stage);

  if (stage && manager.promptClaims.get(id) !== promptHash(stage.prompt)) {
    throw new ConflictError("Stage prompt changed before launch");
  }

  if (!stage?.enabled) {
    throw new ConflictError("Stage is disabled");
  }

  return workerMessage({
    root: manager.paths.root,
    story: story.id,
    stage: story.stage,
    prompt: stage.prompt,
    shim: manager.deps.shim,
    worktree: worktreePath,
    model: `${model.provider}/${model.modelId}`,
    skillsDir: manager.deps.skillsDir,
  });
}

function trackWorkerActivity(manager: ManagerState, run: WorkerRun, handle: PiSession): void {
  run.unsubscribe = handle.session.subscribe((event) => recordActivity(run, event));
  run.activityTimer = setInterval(() => writeActivity(manager, run), 1000);
  run.activityTimer.unref();
}

function recordActivity(run: WorkerRun, event: SessionEvent): void {
  run.lastActivityAt = new Date().toISOString();

  if (event.type === "tool_execution_start") {
    run.lastTool = event.toolName;
  }
}

/** Writes the activity of a worker, but never queues a second write while one is pending. */
function writeActivity(manager: ManagerState, run: WorkerRun): void {
  if (run.activityWritePending) {
    return;
  }

  run.activityWritePending = true;

  void serial(manager, () => persistActivity(manager, run))
    .catch(() => {})
    .finally(() => {
      run.activityWritePending = false;
    });
}

async function persistActivity(manager: ManagerState, run: WorkerRun): Promise<void> {
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
  manager: ManagerState,
  run: WorkerRun,
  handle: PiSession,
): Promise<WorkerResult | undefined> {
  if (run.reportedResult || manager.stopping) {
    return run.reportedResult;
  }

  const fallback = handle.session.getLastAssistantText()?.match(/RESULT:\s*([^\n]+)\s*$/)?.[1];

  if (fallback) {
    return { outcome: fallback, summary: fallback.slice(0, 1000), blockers: [], problems: [] };
  }

  await handle.prompt("Call report_result now with the final outcome, summary, blockers and problems. Then stop.");

  return run.reportedResult;
}

async function completeWorker(
  manager: ManagerState,
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

  if (fresh?.stage === intent.stage) {
    result.problems = [...result.problems.slice(0, 9), "Story remains in the assigned Stage"];
  }

  await changeThread(manager, id, manager.stopping ? "interrupted" : "completed", {
    result,
    resumable: manager.stopping,
  });
}

async function failWorker(manager: ManagerState, run: WorkerRun, error: unknown): Promise<void> {
  await serial(manager, async () => {
    pauseForError(manager, run.assignedProvider, error);

    const thread = await getThread(run.id, manager.ctx);

    if (!isActiveStatus(thread.status)) {
      return;
    }

    await changeThread(manager, run.id, manager.stopping ? "interrupted" : "failed", {
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
async function finishWorker(manager: ManagerState, run: WorkerRun): Promise<void> {
  clearInterval(run.activityTimer);
  run.unsubscribe?.();

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
    manager.active.delete(run.id);
    await persistStatus(manager);
  });
  notify(manager);
}
