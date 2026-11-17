import { join } from "node:path";
import { NotFoundError } from "../errors/errors.js";
import type { WorkerLaunch } from "../factory-manager/worker-executor.js";
import { type FactorySettings, getFactorySettings } from "../factory-settings/factory-settings.js";
import { pathExists } from "../files/files.js";
import { Store } from "../store/store.js";
import { getStory } from "../story/story.js";
import type { ThreadRecord } from "../thread/thread.js";
import { type HostAgentPaths, hostRunPaths, threadPaths } from "./host-agent-paths.js";
import { type HostLaunchData, readLaunchData } from "./host-agent-prepare.js";
import type { HostLaunchRequest, HostWork, HostWorkRunner } from "./host-agent-work.js";
import { bindHostRun, type HostChecks } from "./host-checks.js";
import { updateClone } from "./host-clone-update.js";
import {
  changeRun,
  endRun,
  failureOf,
  type HostRun,
  type RunProgress,
  recordRunCheck,
  requestStop,
  runEvents,
  throwIfStopping,
} from "./host-run-events.js";
import type { HostPiRuntime } from "./host-run-executor.js";
import { type HostRunState, readHostRun } from "./host-run-state.js";

/** The options of the runner of the host agent. */
export interface HostRunnerOptions {
  readonly paths: HostAgentPaths;
  readonly home: string;
  /** The CLI shim of the workers. `host serve` writes it to `paths.bin`. */
  readonly shim: string;
  /** Gives the Pi runtime. The default uses the Pi credentials of the host user. Tests give a faux runtime. */
  readonly runtime?: () => Promise<HostPiRuntime>;
}

/** The prepared data and the facts of one launch or resume, before the work starts. */
interface PreparedRun {
  readonly data: HostLaunchData;
  readonly launch: WorkerLaunch;
  readonly previous: HostRunState | undefined;
  /** The check queue of the agent. Without it, the worker gets no check tools. */
  readonly checks: HostChecks | undefined;
}

/** Makes the runner that runs each remote worker through the local executor. */
export function createHostRunner(options: HostRunnerOptions): HostWorkRunner {
  return { start: (request) => startRun(options, request) };
}

/** A resume needs the session file and the worktree of the last run on this host. */
async function resumeFacts(options: HostRunnerOptions, threadId: string): Promise<HostRunState> {
  const previous = await readHostRun(options.paths, threadId);
  const file = previous?.session?.file;
  const worktree = previous?.worktree?.path;
  const sessionExists = file ? await pathExists(join(options.paths.runtime, file)) : false;
  const worktreeExists = worktree ? await pathExists(worktree) : false;

  if (!previous || !sessionExists || !worktreeExists) {
    throw new NotFoundError(`Thread ${threadId} has no session file or no worktree on this host`, {
      details: { threadId, session: file ?? null, worktree: worktree ?? null },
    });
  }

  return previous;
}

/** The Thread record of a resume: the session file and the worktree of the last run, and more than one run. */
function resumedThread(thread: ThreadRecord, previous: HostRunState, requestId: string): ThreadRecord {
  const last = thread.runs.at(-1);
  const extra = last ? { ...last, id: requestId, status: thread.status } : undefined;
  const runs = thread.runs.length > 1 || !extra ? thread.runs : [...thread.runs, extra];

  return {
    ...thread,
    session: { ...thread.session, file: previous.session?.file ?? null },
    worktree: previous.worktree?.path,
    branch: previous.worktree?.branch,
    runs,
  };
}

async function prepareRun(options: HostRunnerOptions, request: HostLaunchRequest): Promise<PreparedRun> {
  const { paths, home } = options;
  const data = await readLaunchData(paths, request.threadId);
  const previous = request.kind === "resume" ? await resumeFacts(options, request.threadId) : undefined;
  const run = hostRunPaths({
    home,
    projectId: paths.projectId,
    clone: data.clone,
    threadId: data.threadId,
    storyId: data.storyId,
  });
  const story = await getStory({ id: data.storyId }, { cwd: run.copy });
  const base = { ...data.thread, model: data.model ?? data.thread.model };
  const thread = previous ? resumedThread(base, previous, request.requestId) : base;

  return {
    data,
    previous,
    checks: request.checks,
    launch: { thread, story: { ...story, fields: { ...story.fields, worktree: run.worktree } } },
  };
}

function firstState(request: HostLaunchRequest, previous: HostRunState | undefined): HostRunState {
  const now = new Date().toISOString();

  return {
    version: 1,
    threadId: request.threadId,
    requestId: request.requestId,
    kind: request.kind,
    phase: "starting",
    startedAt: now,
    updatedAt: now,
    ...(previous?.worktree ? { worktree: previous.worktree } : {}),
    ...(previous?.session ? { session: previous.session } : {}),
    ...(previous?.checks ? { checks: previous.checks } : {}),
  };
}

/**
 * Reads the factory settings of the copy when the run starts. The check items and the limits of the queue come from
 * them. The job changes of the Thread go to `run.json`.
 */
async function runSettings(run: HostRun, copy: string, checks: HostChecks | undefined): Promise<FactorySettings> {
  const settings = await getFactorySettings({ cwd: copy });

  if (checks) {
    bindHostRun(checks, {
      threadId: run.threadId,
      settings,
      receiver: (job) => recordRunCheck(run, job, checks.queue.deps.now()),
    });
  }

  return settings;
}

/** Updates the clone, opens the executor and runs the worker. Each error goes to `run.json`. */
async function execute(options: HostRunnerOptions, run: HostRun, prepared: PreparedRun): Promise<void> {
  const { copy } = threadPaths(options.paths, run.threadId);

  try {
    await updateClone(prepared.data.clone);
    throwIfStopping(run);

    const settings = await runSettings(run, copy, prepared.checks);
    const { openRunExecutor } = await import("./host-run-executor.js");
    const executor = await openRunExecutor({
      copy,
      clone: prepared.data.clone,
      runtimeDir: options.paths.runtime,
      shim: options.shim,
      env: {
        ROWBLY_OUTBOX: options.paths.outbox,
        ROWBLY_THREAD_ID: run.threadId,
        ROWBLY_HOST_AGENT: options.paths.dir,
      },
      runtime: options.runtime,
      checks: prepared.checks?.queue,
      settings: () => settings,
    });

    run.store.update(() => ({ executor }));
    throwIfStopping(run);
    await executor.launch(prepared.launch, runEvents(run));
  } catch (error) {
    await changeRun(run, { failure: failureOf({ error, sessionOpened: false }) });
  } finally {
    await endRun(run);
  }
}

/**
 * Reads the prepared data of the Thread and starts the work. A Thread without a prepare, or a resume without its
 * session file or worktree, gives a NotFoundError before the work starts.
 */
async function startRun(options: HostRunnerOptions, request: HostLaunchRequest): Promise<HostWork> {
  const prepared = await prepareRun(options, request);
  const run: HostRun = {
    paths: options.paths,
    threadId: request.threadId,
    message: prepared.data.message,
    store: new Store<RunProgress>({ state: firstState(request, prepared.previous), writes: Promise.resolve() }),
  };

  await changeRun(run, {});

  const ended = execute(options, run, prepared).catch(() => undefined);

  return { ended, stop: () => requestStop(run, "stopped"), cancel: () => requestStop(run, "cancelled") };
}
