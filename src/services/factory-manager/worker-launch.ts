import { readConfig } from "../config/config.js";
import { ConflictError } from "../errors/errors.js";
import type { ModelChoice } from "../factory-settings/factory-settings.js";
import { type RunUpstream, upstreamOf, workerMessage } from "../messages/messages.js";
import { projectWrite, projectWriteLockPath } from "../project-write/project-write.js";
import { listStages } from "../stage/stage.js";
import { Store, withEntry, withoutEntry } from "../store/store.js";
import { getStory, type Story, searchStories, updateStory } from "../story/story.js";
import { promptHash } from "../supervisor-digest/supervisor-digest.js";
import { getThread, LOCAL_HOST, type ThreadRecord, type WorkerResult } from "../thread/thread.js";
import {
  changeThread,
  getState,
  isActiveStatus,
  isProviderPaused,
  type Manager,
  type ManagerState,
  notify,
  providerSucceeded,
  serial,
  setState,
} from "./manager-state.js";
import { persistStatus } from "./manager-status.js";
import { executorFor, hostSynced, waitForHostSync } from "./remote-dispatch.js";
import { configuredChecks } from "./worker-checks.js";
import { completeWorker, failWorker } from "./worker-end.js";
import {
  type RunLocation,
  type WorkerActivity,
  type WorkerControl,
  type WorkerEvents,
  type WorkerExecutor,
  type WorkerLaunch,
  type WorkerSession,
  type WorkerWorktree,
  workerControl,
} from "./worker-executor.js";

/** The manager side of one worker launch. The provider comes from the session, when the session opens. */
export interface LaunchState {
  readonly id: string;
  readonly provider?: string;
}

export type LaunchStore = Store<LaunchState>;

/** Checks the reserved worker Thread, runs it through the executor of its host and frees the slot. */
export async function launchWorker(manager: Manager, id: string): Promise<void> {
  const launch = new Store<LaunchState>({ id });

  try {
    const request = await checkedLaunch(manager, launch);

    if (request) {
      await runOnHost(manager, launch, request);
    }
  } finally {
    await releaseWorker(manager, id);
  }
}

/** Runs the worker with the executor of the host of its Thread. */
async function runOnHost(manager: Manager, launch: LaunchStore, request: WorkerLaunch): Promise<void> {
  const host = request.thread.host ?? LOCAL_HOST;
  const events = workerEvents(manager, launch, request);

  if (host === LOCAL_HOST) {
    await manager.executor.launch(request, events);
    return;
  }

  try {
    await runRemote(manager, request, events, executorFor(manager, host));
  } catch (error) {
    await failWorker(manager, launch.current, { error, sessionOpened: false });
  }
}

/**
 * Runs a remote worker. Its Story waits for the host sync until the executor applied the outbox of the host and sent
 * the end of the run, or until its wait ended.
 */
async function runRemote(
  manager: Manager,
  request: WorkerLaunch,
  events: WorkerEvents,
  executor: WorkerExecutor,
): Promise<void> {
  const { thread, story } = request;

  // A stop or a cancel must reach the host also before the session opens.
  setState(manager, (state) => attachControl(state.active, thread.id, workerControl(executor, thread.id)));
  waitForHostSync(manager, story.id);

  try {
    await executor.launch(request, events);
  } finally {
    hostSynced(manager, story.id);
  }
}

/** Gives the launch of a pending Thread, or undefined when the Thread is not pending or a check failed. */
async function checkedLaunch(manager: Manager, launch: LaunchStore): Promise<WorkerLaunch | undefined> {
  try {
    return await prepareLaunch(manager, launch.current.id);
  } catch (error) {
    await failWorker(manager, launch.current, { error, sessionOpened: false });

    return undefined;
  }
}

async function prepareLaunch(manager: Manager, id: string): Promise<WorkerLaunch | undefined> {
  const intent = await getThread(id, manager.ctx);

  await manager.deps.beforeLaunch?.(intent);

  if ((await getThread(id, manager.ctx)).status !== "pending") {
    return undefined;
  }

  if (getState(manager).stopping) {
    throw new ConflictError("Factory is stopping");
  }

  const story = await getStory({ id: intent.storyId as string }, manager.ctx);

  if (story.stage !== intent.stage) {
    throw new ConflictError("Story Stage changed before launch");
  }

  return { thread: intent, story };
}

/** The reactions of the manager to the events of one worker run. Each handler can stop the run with an error. */
export function workerEvents(manager: Manager, launch: LaunchStore, request: WorkerLaunch): WorkerEvents {
  const { thread: intent, story } = request;
  const { id } = launch.current;

  return {
    worktreeReady: (worktree) => serial(manager, () => assignWorktree(manager, id, intent, story.id, worktree)),
    sessionOpened: (session) => openedSession(manager, launch, intent, story.id, session),
    message: (worktree, model, location) =>
      buildWorkerPrompt(manager, { id, intent, story, worktree, model, location }),
    prompted: (model) => recordPromptSuccess(manager, model),
    activity: (activity) => serial(manager, () => persistActivity(manager, id, activity)),
    resultReported: (result) => serial(manager, () => recordResult(manager, id, result)),
    stopping: () => getState(manager).stopping,
    completed: (result, stop) =>
      serial(manager, () => completeWorker(manager, { id, intent, storyId: story.id, result, stop })),
    failed: (failure) => failWorker(manager, launch.current, failure),
    finished: (activity) => serial(manager, () => persistFinalActivity(manager, id, activity)),
  };
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

/** Keeps the control of the open session on the active worker, then checks the run before the prompt. */
async function openedSession(
  manager: Manager,
  launch: LaunchStore,
  intent: ThreadRecord,
  storyId: string,
  session: WorkerSession,
): Promise<void> {
  const { id } = launch.current;

  launch.update(() => ({ provider: session.model.provider }));
  setState(manager, (state) => attachControl(state.active, id, workerControl(executorFor(manager, intent.host), id)));
  manager.deps.onModel?.("worker", session.model);

  await serial(manager, () => startWorkerRun(manager, id, intent, storyId, session));
}

/** Gives the active workers with the control on the entry of the Thread, if the entry is still there. */
function attachControl(active: ManagerState["active"], id: string, control: WorkerControl): Partial<ManagerState> {
  const entry = active.get(id);

  if (!entry) {
    return {};
  }

  return { active: withEntry(active, id, { ...entry, control }) };
}

/** A prompt that succeeded ends the network failures in a row of the provider. */
function recordPromptSuccess(manager: Manager, model: ModelChoice): void {
  setState(manager, (state) => providerSucceeded(state, model.provider));
}

async function recordResult(manager: Manager, id: string, result: WorkerResult): Promise<void> {
  await changeThread(manager, id, "running", { result });
}

async function startWorkerRun(
  manager: Manager,
  id: string,
  intent: ThreadRecord,
  storyId: string,
  session: WorkerSession,
): Promise<void> {
  if (getState(manager).stopping) {
    throw new ConflictError("Factory is stopping");
  }

  if (isProviderPaused(manager, session.model.provider)) {
    throw new ConflictError("Worker provider is paused");
  }

  if ((await getStory({ id: storyId }, manager.ctx)).stage !== intent.stage) {
    throw new ConflictError("Story Stage changed before prompt");
  }

  await changeThread(manager, id, "running", { model: session.model, session: { id, file: session.file } });
}

/** The facts of one worker message. Without a location, the message uses the canonical Project and the daemon. */
interface PromptRequest {
  readonly id: string;
  readonly intent: ThreadRecord;
  readonly story: Story;
  readonly worktree: string;
  readonly model: ModelChoice;
  readonly location?: RunLocation;
}

/** Gives the place of a local run: the canonical Project root, the shim of the daemon and the Project write lock. */
async function localLocation(manager: Manager): Promise<RunLocation> {
  const { root } = manager.paths;

  return { root, shim: manager.deps.shim, lock: await projectWriteLockPath(root), checks: true };
}

async function buildWorkerPrompt(manager: Manager, request: PromptRequest): Promise<string> {
  const { id, intent, story, model } = request;
  const stage = (await listStages(manager.ctx)).find((s) => s.key === intent.stage);

  if (stage && getState(manager).promptClaims.get(id) !== promptHash(stage.prompt)) {
    throw new ConflictError("Stage prompt changed before launch");
  }

  if (!stage?.enabled) {
    throw new ConflictError("Stage is disabled");
  }

  const location = request.location ?? (await localLocation(manager));
  const checks = location.checks ? configuredChecks(manager) : [];

  return workerMessage(manager.paths, {
    story: story.id,
    stage: story.stage,
    stagePrompt: stage.prompt,
    root: location.root,
    worktree: request.worktree,
    model: `${model.provider}/${model.modelId}`,
    shim: location.shim,
    lock: location.lock,
    checks: checks.map((c) => ({ key: c.key, label: c.label, narrow: !!c.narrowCommand })),
    upstream: await readUpstream(manager, story),
  });
}

/** The upstream Stories of the worker message. Reads the Stories and the config only when the Story has dependencies. */
async function readUpstream(manager: Manager, story: Story): Promise<RunUpstream[]> {
  if (story.dependsOn.length === 0) {
    return [];
  }

  const [stories, config] = await Promise.all([searchStories({}, manager.ctx), readConfig(manager.paths)]);
  const urlFieldKeys = config.customFields.filter((field) => field.type === "url").map((field) => field.key);

  return upstreamOf(story, stories, urlFieldKeys);
}

/** Writes the live activity of a worker while its Thread is active. */
async function persistActivity(manager: Manager, id: string, activity: WorkerActivity): Promise<void> {
  const thread = await getThread(id, manager.ctx);

  if (!isActiveStatus(thread.status)) {
    return;
  }

  await changeThread(manager, id, thread.status, activity);
}

async function persistFinalActivity(manager: Manager, id: string, activity: WorkerActivity): Promise<void> {
  const thread = await getThread(id, manager.ctx);

  await changeThread(manager, id, thread.status, activity);
}

/** Frees the slot of the worker after the executor closed its session. */
export async function releaseWorker(manager: Manager, id: string): Promise<void> {
  await serial(manager, async () => {
    setState(manager, (state) => ({ active: withoutEntry(state.active, id) }));
    await persistStatus(manager);
  });
  notify(manager);
}
