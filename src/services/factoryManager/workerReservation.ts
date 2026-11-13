import { stat } from "node:fs/promises";
import { ConflictError } from "../errors/errors.js";
import { releaseStory, storyHash } from "../factoryPolicy/factoryPolicy.js";
import type { ModelChoice } from "../factorySettings/factorySettings.js";
import { updateFactoryState } from "../factoryState/factoryState.js";
import { getStory, type Story } from "../story/story.js";
import {
  appendThreadRun,
  createThread,
  getThread,
  listThreads,
  projectNativeAttempt,
  type ThreadRecord,
} from "../thread/thread.js";
import {
  changeThread,
  getState,
  isActiveStatus,
  isProviderPaused,
  type Manager,
  serial,
  setState,
} from "./managerState.js";
import { classifiedStages, persistStatus, scan } from "./managerStatus.js";
import { withEntry } from "./store.js";
import { launchWorker } from "./workerLaunch.js";

export interface ReserveWorkerInput {
  storyId: string;
  stage: string;
  requestId: string;
  resumeThreadId?: string;
  model?: ModelChoice;
}

/** Reserves a worker slot for an eligible Story, then launches the worker in the background. */
export function reserveWorker(manager: Manager, input: ReserveWorkerInput): Promise<{ threadId: string }> {
  return serial(manager, () => reserveWorkerSlot(manager, input));
}

async function reserveWorkerSlot(manager: Manager, input: ReserveWorkerInput): Promise<{ threadId: string }> {
  const prior = getState(manager).requests.get(input.requestId);

  if (prior) {
    return { threadId: prior };
  }

  const story = await assertSlotAvailable(manager, input);

  if (input.resumeThreadId) {
    const previous = await getThread(input.resumeThreadId, manager.ctx);

    if (previous.runs.at(-1)?.id === input.requestId) {
      return { threadId: previous.id };
    }

    await releaseForResume(manager, previous, story);
  }

  const choice = input.model ?? getState(manager).settings.workerModel;

  await assertWorkerModel(manager, choice);

  const policy = await scan(manager, Number.MAX_SAFE_INTEGER);
  const decision = policy.decisions.find((d) => d.story === story.id);

  if (!decision || !["start", "retry"].includes(decision.action)) {
    throw new ConflictError(`Story is not eligible: ${decision?.reason ?? "missing"}`);
  }

  await updateFactoryState(manager.paths.root, () => policy.state, manager.ctx);

  const created = input.resumeThreadId
    ? await appendResumeRun(manager, input.resumeThreadId, story, input.requestId)
    : await createWorkerThread(manager, story, decision.attempt ?? 1);
  const thread = choice ? await changeThread(manager, created.id, "pending", { model: choice }) : created;

  await projectNativeAttempt(thread.id, manager.ctx);

  const stage = (await classifiedStages(manager)).find((s) => s.key === story.stage);

  setState(manager, (state) => ({
    promptClaims: withEntry(state.promptClaims, thread.id, stage?.promptHash ?? ""),
    requests: withEntry(state.requests, input.requestId, thread.id),
  }));
  startWorkerTask(manager, thread.id);

  await persistStatus(manager);

  return { threadId: thread.id };
}

/** Checks that the factory runs, the Story has no worker and is in the Stage, and a slot is free. */
async function assertSlotAvailable(manager: Manager, input: ReserveWorkerInput): Promise<Story> {
  if (getState(manager).stopping) {
    throw new ConflictError("Factory is stopping");
  }

  const { threads } = await listThreads({ role: "worker" }, manager.ctx);
  const activeThreads = threads.filter((t) => isActiveStatus(t.status));

  if (activeThreads.some((t) => t.storyId === input.storyId)) {
    throw new ConflictError("Story already has an active worker");
  }

  const story = await getStory({ id: input.storyId }, manager.ctx);

  if (story.stage !== input.stage) {
    throw new ConflictError("Story Stage changed");
  }

  const { active, limit } = getState(manager);

  if (Math.max(active.size, activeThreads.length) >= limit) {
    throw new ConflictError("Worker capacity is full");
  }

  return story;
}

function canResume(thread: ThreadRecord, story: Story): boolean {
  return (
    !!thread.resumable &&
    thread.status !== "completed" &&
    thread.runs.length < 3 &&
    thread.storyId === story.id &&
    thread.stage === story.stage &&
    !!thread.worktree
  );
}

/** Checks a resume, then releases the policy parking and the user cancellation of the Story. */
async function releaseForResume(manager: Manager, previous: ThreadRecord, story: Story): Promise<void> {
  if (!canResume(previous, story)) {
    throw new ConflictError("Thread cannot resume in this Stage");
  }

  await stat(previous.worktree as string);
  await updateFactoryState(
    manager.paths.root,
    (state) => {
      const cancelled = Object.entries((state.nativeCancelled as object) ?? {});
      const nativeCancelled = Object.fromEntries(cancelled.filter(([storyId]) => storyId !== story.id));

      return { ...releaseStory(state, story.id), nativeCancelled };
    },
    manager.ctx,
  );
}

async function assertWorkerModel(manager: Manager, choice: ModelChoice | undefined): Promise<void> {
  if (!choice) {
    return;
  }

  const { validateModelChoice } = await import("../agentAuth/agentAuth.js");

  await validateModelChoice(manager.deps.runtime, choice);

  if (isProviderPaused(manager, choice.provider)) {
    throw new ConflictError("Worker provider is paused");
  }
}

async function appendResumeRun(manager: Manager, threadId: string, story: Story, runId: string): Promise<ThreadRecord> {
  const previous = await getThread(threadId, manager.ctx);

  if (previous.role !== "worker" || !canResume(previous, story)) {
    throw new ConflictError("Thread cannot resume in this Stage");
  }

  if (!(await stat(previous.worktree as string)).isDirectory()) {
    throw new ConflictError("Resume worktree is unavailable");
  }

  return appendThreadRun(
    previous.id,
    { expectedRevision: previous.revision, ownerToken: manager.owner.token, runId },
    manager.ctx,
  );
}

function createWorkerThread(manager: Manager, story: Story, attemptNumber: number): Promise<ThreadRecord> {
  return createThread(
    {
      role: "worker",
      storyId: story.id,
      stage: story.stage,
      cwd: manager.paths.root,
      ownerToken: manager.owner.token,
      parentThreadId: getState(manager).supervisorId,
      attemptNumber,
    },
    manager.ctx,
  );
}

/**
 * Registers the worker slot before the launch starts, so that the slot counts at once.
 * The launch starts in a later microtask, after the registration.
 */
function startWorkerTask(manager: Manager, threadId: string): void {
  const task = Promise.resolve().then(() => launchWorker(manager, threadId));

  setState(manager, (state) => ({ active: withEntry(state.active, threadId, { task }) }));
}

/** Cancels the expected run of an active worker and holds its Story in the current Stage. */
export async function cancelWorker(manager: Manager, id: string, expectedRunId: string): Promise<void> {
  const session = await serial(manager, async () => {
    const thread = await getThread(id, manager.ctx);
    const lastRun = thread.runs.at(-1);

    if (lastRun?.id !== expectedRunId || lastRun?.ownerToken !== manager.owner.token) {
      throw new ConflictError("Worker run changed");
    }

    if (thread.status === "cancelled") {
      return undefined;
    }

    if (!getState(manager).active.has(id) || !isActiveStatus(thread.status)) {
      throw new ConflictError("Worker is not active");
    }

    const story = await getStory({ id: thread.storyId as string }, manager.ctx);

    await updateFactoryState(
      manager.paths.root,
      (state) => ({
        ...state,
        nativeCancelled: {
          ...((state.nativeCancelled as object) ?? {}),
          [story.id]: { stage: story.stage, hash: storyHash(story) },
        },
      }),
      manager.ctx,
    );
    await changeThread(manager, id, "cancelled", { resumable: !!thread.session.file });

    return getState(manager).active.get(id)?.session;
  });

  await session?.session.abort();
}

/** Resumes a Thread with a new run. A repeated request for the same run does nothing. */
export async function resumeWorker(
  manager: Manager,
  id: string,
  expectedRunId: string,
  requestId: string,
): Promise<void> {
  const thread = await getThread(id, manager.ctx);
  const lastRunId = thread.runs.at(-1)?.id;

  if (lastRunId !== expectedRunId) {
    if (lastRunId && lastRunId === requestId) {
      return;
    }

    throw new ConflictError("Worker run changed");
  }

  await reserveWorker(manager, {
    storyId: thread.storyId as string,
    stage: thread.stage as string,
    requestId,
    resumeThreadId: id,
  });
}
