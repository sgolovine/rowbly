import { randomUUID } from "node:crypto";
import { stat } from "node:fs/promises";
import { ConflictError, NotFoundError, ValidationError } from "../errors/errors.js";
import type { ModelChoice } from "../factory-settings/factory-settings.js";
import { loadFactoryState } from "../factory-state/factory-state.js";
import { prepareRuntime, runtimePath } from "../runtime-files/runtime-files.js";
import { findProject, type ServiceContext } from "../workspace/workspace.js";
import { getThread, saveThread } from "./thread-files.js";
import { isTerminal, type ThreadPatch, type ThreadRecord, type ThreadRun, type ThreadStatus } from "./thread-types.js";

interface CreateInput {
  id?: string;
  role: ThreadRecord["role"];
  storyId?: string;
  stage?: string;
  attemptNumber?: number;
  parentThreadId?: string;
  cwd: string;
  ownerToken: string;
  model?: ModelChoice;
}

interface TransitionInput {
  expectedRevision: number;
  status: ThreadStatus;
  patch?: ThreadPatch;
}

interface ResumeInput {
  expectedRevision: number;
  ownerToken: string;
  runId?: string;
}

function nowText(ctx: ServiceContext): string {
  return (ctx.now?.() ?? new Date()).toISOString();
}

async function assertAbsent(id: string, ctx: ServiceContext): Promise<void> {
  const exists = await getThread(id, ctx).then(
    () => true,
    (error: unknown) => {
      if (error instanceof NotFoundError) {
        return false;
      }

      throw error;
    },
  );

  if (exists) {
    throw new ConflictError(`Thread ${id} already exists`);
  }
}

/** Creates the metadata of a new pending Thread with its first run. */
export async function createThread(input: CreateInput, ctx: ServiceContext = {}): Promise<ThreadRecord> {
  const paths = await findProject(ctx);

  await prepareRuntime(paths);

  return (await loadFactoryState(ctx)).withStateLock(paths.root, async () => {
    const id = input.id ?? randomUUID();

    await assertAbsent(id, ctx);

    const createdAt = nowText(ctx);
    const { ownerToken, ...fields } = input;
    const run: ThreadRun = { id: randomUUID(), ownerToken, createdAt, status: "pending" };

    return saveThread(
      {
        ...fields,
        version: 1,
        id,
        revision: 1,
        status: "pending",
        createdAt,
        session: { id, file: null },
        runs: [run],
        resumable: false,
      },
      ctx,
    );
  });
}

/** Gives the last run with the new status and the times that the status starts or ends. */
function transitionedRun(run: ThreadRun, status: ThreadStatus, now: string): ThreadRun {
  const started = status === "running" ? { startedAt: run.startedAt ?? now } : {};
  const ended = isTerminal(status) ? { endedAt: run.endedAt ?? now } : {};

  return { ...run, status, ...started, ...ended };
}

function withoutError(t: ThreadRecord): ThreadRecord {
  const { error: _error, ...rest } = t;

  return rest;
}

function transitioned(t: ThreadRecord, input: TransitionInput, now: string): ThreadRecord {
  const run = t.runs.at(-1);

  if (!run) {
    throw new ValidationError("Missing thread run");
  }

  const { status } = input;
  const started = status === "running" ? { startedAt: t.startedAt ?? now } : {};
  const ended = isTerminal(status) ? { completedAt: t.completedAt ?? now } : {};
  const runs = [...t.runs.slice(0, -1), transitionedRun(run, status, now)];

  const next = { ...t, ...input.patch, status, revision: t.revision + 1, runs, ...started, ...ended };

  // A completed Thread keeps no error from an earlier run.
  return status === "completed" ? withoutError(next) : next;
}

/** Moves a Thread to a new status. A final status cannot change, and a running Thread cannot become pending. */
export async function transitionThread(
  id: string,
  input: TransitionInput,
  ctx: ServiceContext = {},
): Promise<ThreadRecord> {
  const paths = await findProject(ctx);

  return (await loadFactoryState(ctx)).withStateLock(paths.root, async () => {
    const t = await getThread(id, ctx);

    if (t.revision !== input.expectedRevision) {
      throw new ConflictError("Thread revision changed");
    }

    if ((isTerminal(t.status) && input.status !== t.status) || (t.status === "running" && input.status === "pending")) {
      throw new ConflictError("Invalid thread transition");
    }

    return saveThread(transitioned(t, input, nowText(ctx)), ctx);
  });
}

function resumed(t: ThreadRecord, input: ResumeInput, now: string): ThreadRecord {
  const { error, result, completedAt: _completedAt, ...rest } = t;
  const previous = t.runs.map((run, index) =>
    index === t.runs.length - 1 ? { ...run, reason: run.reason ?? error?.message ?? result?.summary } : run,
  );
  const run: ThreadRun = {
    id: input.runId ?? randomUUID(),
    ownerToken: input.ownerToken,
    createdAt: now,
    status: "pending",
  };

  return { ...rest, runs: [...previous, run], status: "pending", revision: t.revision + 1, resumable: false };
}

/** Adds a pending run to a final, resumable Thread that still has its session file. */
export async function appendThreadRun(id: string, input: ResumeInput, ctx: ServiceContext = {}): Promise<ThreadRecord> {
  const paths = await findProject(ctx);

  return (await loadFactoryState(ctx)).withStateLock(paths.root, async () => {
    const t = await getThread(id, ctx);

    if (t.revision !== input.expectedRevision || !isTerminal(t.status) || !t.resumable || !t.session.file) {
      throw new ConflictError("Thread cannot resume");
    }

    await stat(await runtimePath(paths, t.session.file));

    return saveThread(resumed(t, input, nowText(ctx)), ctx);
  });
}
