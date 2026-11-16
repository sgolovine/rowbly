import type { ModelRuntime } from "@earendil-works/pi-coding-agent";
import { cancelThreadChecks } from "../check-queue/check-queue.js";
import type { CheckQueue } from "../check-queue/check-types.js";
import { ConflictError } from "../errors/errors.js";
import type { FactorySettings } from "../factory-settings/factory-settings.js";
import { createResultTool } from "../factory-worker/factory-worker.js";
import { openFactorySession } from "../pi-runtime/factory-session.js";
import type { PiSession } from "../pi-runtime/pi-runtime.js";
import { Store, withEntry, withoutEntry } from "../store/store.js";
import type { Story } from "../story/story.js";
import type { WorkerResult } from "../thread/thread.js";
import { prepareWorkerWorktree } from "../worker-worktree/worker-worktree.js";
import type { ProjectPaths, ServiceContext } from "../workspace/workspace.js";
import { workerChecks } from "./worker-checks.js";
import type {
  WorkerActivity,
  WorkerControl,
  WorkerEvents,
  WorkerExecutor,
  WorkerLaunch,
  WorkerUsage,
} from "./worker-executor.js";

type OpenedSession = Awaited<ReturnType<typeof openFactorySession>>;
type SessionEvent = Parameters<Parameters<PiSession["session"]["subscribe"]>[0]>[0];

/** The dependencies of the local executor. It gets no full manager. */
export interface LocalExecutorInput {
  /** `root` goes to `ROWBLY_ROOT` of the worker shell. The session files are below `runtimeDir`. */
  readonly paths: Pick<ProjectPaths, "root" | "runtimeDir">;
  readonly ctx: ServiceContext;
  readonly runtime: ModelRuntime;
  readonly agentDir: string;
  readonly shim: string;
  /** Without a check queue, a worker gets no check tools and no check gate. */
  readonly checks?: CheckQueue;
  /** Gives the current factory settings. Without it, each Thread must have a model. */
  readonly settings?: () => FactorySettings;
  /** The Git root of the worktrees. The default is `paths.root`. A worker host gives its clone. */
  readonly gitRoot?: string;
  /** Extra variables of the worker shell. */
  readonly env?: Readonly<Record<string, string>>;
}

/** The controls of the open sessions, by Thread ID. */
interface OpenSessions {
  readonly controls: ReadonlyMap<string, WorkerControl>;
}

/** The fixed environment of the local executor, and the store of its open sessions. */
interface LocalExecutor {
  readonly input: LocalExecutorInput;
  readonly sessions: Store<OpenSessions>;
}

/** The state of one local worker run, from the worktree to the close of its session. */
interface WorkerRun {
  readonly id: string;
  readonly handle?: PiSession;
  readonly reportedResult?: WorkerResult;
  readonly lastActivityAt: string;
  readonly lastTool?: string;
  readonly unsubscribe?: () => void;
  readonly activityTimer?: NodeJS.Timeout;
  readonly activityWritePending: boolean;
}

type RunStore = Store<WorkerRun>;

/** Makes the executor that runs each worker in a Pi session of this process. */
export function createLocalExecutor(input: LocalExecutorInput): WorkerExecutor {
  const executor: LocalExecutor = { input, sessions: new Store<OpenSessions>({ controls: new Map() }) };

  return {
    launch: (launch, events) => launchLocal(executor, launch, events),
    stop: (threadId) => controlOf(executor, threadId)?.stop() ?? Promise.resolve(),
    cancel: (threadId) => controlOf(executor, threadId)?.cancel() ?? Promise.resolve(),
    steer: (threadId, message) => steerLocal(executor, threadId, message),
  };
}

/** Gives the operations of one Pi session. A stop and a cancel both abort the session. */
export function sessionControl(handle: PiSession): WorkerControl {
  return {
    stop: () => handle.session.abort(),
    cancel: () => handle.session.abort(),
    steer: (message) => steerSession(handle, message),
  };
}

/**
 * Gives a message to a session that streams. Pi delivers it after the current tool calls.
 * A session that does not stream gets no message, because a new prompt outside the worker run can break its result.
 */
async function steerSession(handle: PiSession, message: string): Promise<void> {
  if (!handle.session.isStreaming) {
    throw new ConflictError("Worker is not working now");
  }

  await handle.session.steer(message);
}

function controlOf(executor: LocalExecutor, threadId: string): WorkerControl | undefined {
  return executor.sessions.current.controls.get(threadId);
}

async function steerLocal(executor: LocalExecutor, threadId: string, message: string): Promise<void> {
  const control = controlOf(executor, threadId);

  if (!control) {
    throw new ConflictError("Worker has no session");
  }

  await control.steer(message);
}

async function launchLocal(executor: LocalExecutor, launch: WorkerLaunch, events: WorkerEvents): Promise<void> {
  const run = new Store<WorkerRun>({
    id: launch.thread.id,
    lastActivityAt: new Date().toISOString(),
    activityWritePending: false,
  });

  try {
    await runWorker(executor, run, launch, events);
  } catch (error) {
    await events.failed({ error, sessionOpened: !!run.current.handle });
  } finally {
    await finishWorker(executor, run.current, events);
  }
}

async function runWorker(executor: LocalExecutor, run: RunStore, launch: WorkerLaunch, events: WorkerEvents) {
  const { input } = executor;
  const worktree = await prepareWorkerWorktree(input.gitRoot ?? input.paths.root, worktreeStory(launch));

  await events.worktreeReady(worktree);

  const opened = await openWorkerSession(executor, run, launch, worktree.path, events);

  await events.sessionOpened({ model: opened.model, file: opened.file });

  const prompt = await events.message(worktree.path, opened.model);

  trackWorkerActivity(run, opened.handle, events);
  await opened.handle.prompt(prompt);
  events.prompted(opened.model);

  const result = await collectWorkerResult(run, opened.handle, events);

  await events.completed(result);
}

/** A resume keeps the worktree of the Thread in place of the worktree field of the Story. */
function worktreeStory({ thread, story }: WorkerLaunch): Story {
  if (thread.runs.length <= 1) {
    return story;
  }

  return { ...story, fields: { ...story.fields, worktree: thread.worktree ?? null } };
}

async function openWorkerSession(
  executor: LocalExecutor,
  run: RunStore,
  launch: WorkerLaunch,
  worktreePath: string,
  events: WorkerEvents,
): Promise<OpenedSession> {
  const { input } = executor;
  const resultTool = createResultTool((result) => recordResult(run, events, result));
  const checks = executorChecks(input, launch, worktreePath);
  const opened = await openFactorySession({
    thread: launch.thread,
    runtimeDir: input.paths.runtimeDir,
    runtime: input.runtime,
    agentDir: input.agentDir,
    choice: launch.thread.model ?? input.settings?.().workerModel,
    worker: { cwd: worktreePath, root: input.paths.root, shim: input.shim, checks: checks.checks, env: input.env },
    tools: [resultTool, ...checks.tools],
  });

  run.update(() => ({ handle: opened.handle }));
  executor.sessions.update(({ controls }) => ({
    controls: withEntry(controls, run.current.id, sessionControl(opened.handle)),
  }));

  return opened;
}

/** Gives the check tools of a worker. An executor without a check queue or settings gives none. */
function executorChecks(input: LocalExecutorInput, launch: WorkerLaunch, worktreePath: string) {
  const { checks: queue, settings } = input;

  if (!queue || !settings) {
    return { tools: [], checks: [] };
  }

  return workerChecks(
    { queue, ctx: input.ctx, root: input.paths.root, shim: input.shim, settings, env: input.env },
    launch.thread,
    worktreePath,
  );
}

async function recordResult(run: RunStore, events: WorkerEvents, result: WorkerResult): Promise<void> {
  await events.resultReported(result);
  run.update(() => ({ reportedResult: result }));
}

function trackWorkerActivity(run: RunStore, handle: PiSession, events: WorkerEvents): void {
  const unsubscribe = handle.session.subscribe((event) => recordActivity(run, event));
  const activityTimer = setInterval(() => writeActivity(run, handle, events), 1000);

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

/** Sends the activity of a worker, but never sends a second activity while one is pending. */
function writeActivity(run: RunStore, handle: PiSession, events: WorkerEvents): void {
  if (run.current.activityWritePending) {
    return;
  }

  run.update(() => ({ activityWritePending: true }));

  void events
    .activity(activityOf(run.current, liveUsage(handle)))
    .catch(() => {})
    .finally(() => run.update(() => ({ activityWritePending: false })));
}

function activityOf(run: WorkerRun, usage: WorkerUsage): WorkerActivity {
  return { lastActivityAt: run.lastActivityAt, lastTool: run.lastTool, usage };
}

function liveUsage(handle: PiSession): WorkerUsage {
  const stats = handle.session.getSessionStats();

  return { ...stats.tokens, cost: stats.cost };
}

function finalUsage(handle: PiSession): WorkerUsage {
  const stats = handle.session.getSessionStats();

  return {
    input: stats.tokens.input,
    output: stats.tokens.output,
    cacheRead: stats.tokens.cacheRead,
    cacheWrite: stats.tokens.cacheWrite,
    cost: stats.cost,
  };
}

/** Takes the reported result, or a RESULT line, or asks the worker one more time to report. */
async function collectWorkerResult(
  run: RunStore,
  handle: PiSession,
  events: WorkerEvents,
): Promise<WorkerResult | undefined> {
  if (run.current.reportedResult || events.stopping()) {
    return run.current.reportedResult;
  }

  const fallback = handle.session.getLastAssistantText()?.match(/RESULT:\s*([^\n]+)\s*$/)?.[1];

  if (fallback) {
    return { outcome: fallback, summary: fallback.slice(0, 1000), blockers: [], problems: [] };
  }

  await handle.prompt("Call report_result now with the final outcome, summary, blockers and problems. Then stop.");

  return run.current.reportedResult;
}

/** Stops the activity tracking and the checks, sends the final usage and closes the session. */
async function finishWorker(executor: LocalExecutor, run: WorkerRun, events: WorkerEvents): Promise<void> {
  try {
    clearInterval(run.activityTimer);
    run.unsubscribe?.();
    if (executor.input.checks) {
      await cancelThreadChecks(executor.input.checks, run.id);
    }

    if (run.handle) {
      await events.finished(activityOf(run, finalUsage(run.handle)));
    }

    await run.handle?.close();
  } finally {
    executor.sessions.update(({ controls }) => ({ controls: withoutEntry(controls, run.id) }));
  }
}
