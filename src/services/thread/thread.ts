import { randomUUID } from "node:crypto";
import { watch } from "node:fs";
import { readdir, readFile, stat } from "node:fs/promises";
import { isAbsolute } from "node:path";
import { ConflictError, NotFoundError, ValidationError } from "../errors/errors.js";
import { type ModelChoice, validModel } from "../factory-settings/factory-settings.js";
import { loadFactoryState, updateFactoryState } from "../factory-state/factory-state.js";
import { writeFileAtomic } from "../files/files.js";
import { prepareRuntime, runtimePath } from "../runtime-files/runtime-files.js";
import { findProject, type ServiceContext } from "../workspace/workspace.js";

export type ThreadStatus = "pending" | "running" | "completed" | "failed" | "cancelled" | "interrupted";
export interface ThreadRun {
  id: string;
  ownerToken: string;
  createdAt: string;
  startedAt?: string;
  endedAt?: string;
  status: ThreadStatus;
  reason?: string;
}
export interface WorkerResult {
  outcome: string;
  summary: string;
  branch?: string;
  commits?: string[];
  pullRequest?: string;
  blockers: string[];
  problems: string[];
}
export interface ThreadRecord {
  version: 1;
  id: string;
  revision: number;
  role: "supervisor" | "worker";
  storyId?: string;
  stage?: string;
  attemptNumber?: number;
  parentThreadId?: string;
  model?: ModelChoice;
  status: ThreadStatus;
  createdAt: string;
  startedAt?: string;
  completedAt?: string;
  session: { id: string; file: string | null; formatVersion?: number; leafId?: string };
  cwd: string;
  worktree?: string;
  branch?: string;
  runs: ThreadRun[];
  result?: WorkerResult;
  error?: {
    class: "auth" | "quota" | "transient" | "launch" | "storage" | "configuration" | "unknown";
    code: string;
    message: string;
    retryAt?: string;
  };
  resumable: boolean;
  lastActivityAt?: string;
  lastTool?: string;
  usage?: { input: number; output: number; cacheRead: number; cacheWrite: number; cost: number };
}
const statuses: ThreadStatus[] = ["pending", "running", "completed", "failed", "cancelled", "interrupted"];
const terminal = (status: ThreadStatus) => status !== "pending" && status !== "running";
function validId(id: string): boolean {
  return typeof id === "string" && /^[a-zA-Z0-9_-]{1,128}$/.test(id);
}
function validate(value: unknown): ThreadRecord {
  const t = value as ThreadRecord;
  if (
    t?.version !== 1 ||
    typeof t.id !== "string" ||
    !validId(t.id) ||
    !Number.isSafeInteger(t.revision) ||
    t.revision < 1 ||
    !["worker", "supervisor"].includes(t.role) ||
    !statuses.includes(t.status) ||
    !Number.isFinite(Date.parse(t.createdAt)) ||
    typeof t.cwd !== "string" ||
    !isAbsolute(t.cwd) ||
    typeof t.resumable !== "boolean" ||
    (t.role === "worker" && (!t.storyId || !t.stage)) ||
    (t.storyId !== undefined && (typeof t.storyId !== "string" || !/^[A-Z][A-Z0-9]*-\d+$/.test(t.storyId))) ||
    (t.stage !== undefined && (typeof t.stage !== "string" || !/^[A-Z][A-Z0-9_]*$/.test(t.stage))) ||
    (t.parentThreadId !== undefined && !validId(t.parentThreadId)) ||
    (t.attemptNumber !== undefined && (!Number.isSafeInteger(t.attemptNumber) || t.attemptNumber < 1)) ||
    [t.startedAt, t.completedAt, t.lastActivityAt].some(
      (v) => v !== undefined && (typeof v !== "string" || !Number.isFinite(Date.parse(v))),
    ) ||
    [t.branch, t.lastTool].some((v) => v !== undefined && typeof v !== "string") ||
    (t.worktree !== undefined && (typeof t.worktree !== "string" || !isAbsolute(t.worktree))) ||
    (t.usage !== undefined &&
      (!t.usage ||
        [t.usage.input, t.usage.output, t.usage.cacheRead, t.usage.cacheWrite, t.usage.cost].some(
          (v) => typeof v !== "number" || !Number.isFinite(v) || v < 0,
        ))) ||
    (t.error !== undefined &&
      (!t.error ||
        !["auth", "quota", "transient", "launch", "storage", "configuration", "unknown"].includes(t.error.class) ||
        typeof t.error.code !== "string" ||
        typeof t.error.message !== "string")) ||
    !t.session ||
    t.session.id !== t.id ||
    !(t.session.file === null || typeof t.session.file === "string") ||
    !Array.isArray(t.runs) ||
    !t.runs.length ||
    t.runs.some(
      (r) =>
        !r ||
        !validId(r.id) ||
        typeof r.ownerToken !== "string" ||
        !r.ownerToken ||
        !statuses.includes(r.status) ||
        !Number.isFinite(Date.parse(r.createdAt)) ||
        [r.startedAt, r.endedAt].some(
          (v) => v !== undefined && (typeof v !== "string" || !Number.isFinite(Date.parse(v))),
        ) ||
        (r.reason !== undefined && typeof r.reason !== "string"),
    ) ||
    new Set(t.runs.map((r) => r.id)).size !== t.runs.length ||
    t.runs.at(-1)?.status !== t.status ||
    (t.model !== undefined && !validModel(t.model))
  ) {
    throw new ValidationError("Invalid thread metadata");
  }
  if (
    t.result !== undefined &&
    (!t.result ||
      typeof t.result.outcome !== "string" ||
      typeof t.result.summary !== "string" ||
      t.result.summary.length > 1000 ||
      !Array.isArray(t.result.blockers) ||
      !Array.isArray(t.result.problems) ||
      [t.result.blockers, t.result.problems].some(
        (a) => a.length > 10 || a.some((s) => typeof s !== "string" || s.length > 500),
      ) ||
      (t.result.commits !== undefined &&
        (!Array.isArray(t.result.commits) ||
          t.result.commits.length > 20 ||
          t.result.commits.some((s) => typeof s !== "string"))))
  ) {
    throw new ValidationError("Invalid worker result");
  }
  return t;
}
async function threadPath(id: string, ctx: ServiceContext) {
  if (!validId(id)) {
    throw new ValidationError("Invalid thread ID");
  }
  return runtimePath(await findProject(ctx), `threads/${id}.json`);
}
async function checkSession(t: ThreadRecord, ctx: ServiceContext) {
  if (t.session.file !== null) {
    if (!t.session.file.startsWith(`sessions/${t.id}/`) || !t.session.file.endsWith(".jsonl")) {
      throw new ValidationError("Invalid thread session reference");
    }
    await runtimePath(await findProject(ctx), t.session.file);
  }
}
export async function getThread(id: string, ctx: ServiceContext = {}): Promise<ThreadRecord> {
  const file = await threadPath(id, ctx);
  try {
    if ((await stat(file)).size > 1024 * 1024) {
      throw new ValidationError("Thread metadata is too large");
    }
    const t = validate(JSON.parse(await readFile(file, "utf8")));
    if (t.id !== id) {
      throw new ValidationError("Thread ID does not match its file");
    }
    await checkSession(t, ctx);
    return t;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      throw new NotFoundError(`Thread ${id} not found`);
    }
    if (error instanceof SyntaxError) {
      throw new ValidationError(`Invalid thread JSON: ${id}`);
    }
    throw error;
  }
}
export interface ThreadList {
  threads: ThreadRecord[];
  issues: { file: string; message: string }[];
}
export async function listThreads(
  input: { story?: string; role?: ThreadRecord["role"]; status?: ThreadStatus } = {},
  ctx: ServiceContext = {},
): Promise<ThreadList> {
  const paths = await findProject(ctx);
  const dir = await runtimePath(paths, "threads");
  const files = await readdir(dir).catch((e: NodeJS.ErrnoException) => {
    if (e.code === "ENOENT") {
      return [];
    }
    throw e;
  });
  const result: ThreadList = { threads: [], issues: [] };
  for (const file of files.filter((f) => f.endsWith(".json")).sort()) {
    try {
      const t = await getThread(file.slice(0, -5), ctx);
      if (
        (!input.story || t.storyId === input.story) &&
        (!input.role || t.role === input.role) &&
        (!input.status || t.status === input.status)
      ) {
        result.threads.push(t);
      }
    } catch (e) {
      result.issues.push({ file: `threads/${file}`, message: e instanceof Error ? e.message : "Thread unavailable" });
    }
  }
  result.threads.sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id));
  return result;
}
async function save(t: ThreadRecord, ctx: ServiceContext) {
  validate(t);
  await checkSession(t, ctx);
  const text = `${JSON.stringify(t)}\n`;
  if (Buffer.byteLength(text) > 1024 * 1024) {
    throw new ValidationError("Thread metadata is too large");
  }
  await writeFileAtomic(await threadPath(t.id, ctx), text, { mode: 0o600, durable: true });
  return t;
}
export async function createThread(
  input: {
    id?: string;
    role: ThreadRecord["role"];
    storyId?: string;
    stage?: string;
    attemptNumber?: number;
    parentThreadId?: string;
    cwd: string;
    ownerToken: string;
    model?: ModelChoice;
  },
  ctx: ServiceContext = {},
): Promise<ThreadRecord> {
  const paths = await findProject(ctx);
  await prepareRuntime(paths);
  return (await loadFactoryState(ctx)).withStateLock(paths.root, async () => {
    const id = input.id ?? randomUUID();
    try {
      await getThread(id, ctx);
      throw new ConflictError(`Thread ${id} already exists`);
    } catch (e) {
      if (!(e instanceof NotFoundError)) {
        throw e;
      }
    }
    const createdAt = (ctx.now?.() ?? new Date()).toISOString();
    const { ownerToken, ...fields } = input;
    return save(
      {
        ...fields,
        version: 1,
        id,
        revision: 1,
        status: "pending",
        createdAt,
        session: { id, file: null },
        runs: [{ id: randomUUID(), ownerToken, createdAt, status: "pending" }],
        resumable: false,
      },
      ctx,
    );
  });
}
export async function transitionThread(
  id: string,
  input: {
    expectedRevision: number;
    status: ThreadStatus;
    patch?: Partial<
      Pick<
        ThreadRecord,
        | "cwd"
        | "session"
        | "model"
        | "result"
        | "error"
        | "resumable"
        | "worktree"
        | "branch"
        | "lastActivityAt"
        | "lastTool"
        | "usage"
      >
    >;
  },
  ctx: ServiceContext = {},
): Promise<ThreadRecord> {
  const paths = await findProject(ctx);
  return (await loadFactoryState(ctx)).withStateLock(paths.root, async () => {
    const t = await getThread(id, ctx);
    if (t.revision !== input.expectedRevision) {
      throw new ConflictError("Thread revision changed");
    }
    if ((terminal(t.status) && input.status !== t.status) || (t.status === "running" && input.status === "pending")) {
      throw new ConflictError("Invalid thread transition");
    }
    const now = (ctx.now?.() ?? new Date()).toISOString();
    Object.assign(t, input.patch);
    t.status = input.status;
    if (t.status === "completed") {
      delete t.error;
    }
    t.revision++;
    const run = t.runs.at(-1);
    if (!run) {
      throw new ValidationError("Missing thread run");
    }
    run.status = t.status;
    if (t.status === "running") {
      t.startedAt ??= now;
      run.startedAt ??= now;
    }
    if (terminal(t.status)) {
      t.completedAt ??= now;
      run.endedAt ??= now;
    }
    return save(t, ctx);
  });
}
export async function appendThreadRun(
  id: string,
  input: { expectedRevision: number; ownerToken: string; runId?: string },
  ctx: ServiceContext = {},
): Promise<ThreadRecord> {
  const paths = await findProject(ctx);
  return (await loadFactoryState(ctx)).withStateLock(paths.root, async () => {
    const t = await getThread(id, ctx);
    if (t.revision !== input.expectedRevision || !terminal(t.status) || !t.resumable || !t.session.file) {
      throw new ConflictError("Thread cannot resume");
    }
    await stat(await runtimePath(paths, t.session.file));
    const previous = t.runs.at(-1);
    if (previous) {
      previous.reason ??= t.error?.message ?? t.result?.summary;
    }
    delete t.error;
    delete t.result;
    t.runs.push({
      id: input.runId ?? randomUUID(),
      ownerToken: input.ownerToken,
      createdAt: (ctx.now?.() ?? new Date()).toISOString(),
      status: "pending",
    });
    t.status = "pending";
    t.revision++;
    delete t.completedAt;
    t.resumable = false;
    return save(t, ctx);
  });
}
/** Repairs the second half of a durable intent transaction without duplicate attempts. */
export async function projectNativeAttempt(id: string, ctx: ServiceContext = {}): Promise<void> {
  const paths = await findProject(ctx);
  await updateFactoryState(
    paths.root,
    async (state) => {
      const t = await getThread(id, ctx);
      if (t.role !== "worker" || !t.storyId || !t.stage) {
        return state;
      }
      let attempt = state.attempts.find((a) => a.threadId === t.id);
      if (!attempt) {
        attempt = {
          story: t.storyId,
          stage: t.stage,
          workerId: t.id,
          threadId: t.id,
          status: "preparing",
          startReported: false,
        };
        state.attempts.push(attempt);
      }
      attempt.status = t.status === "pending" ? "preparing" : t.status === "cancelled" ? "interrupted" : t.status;
      attempt.model = t.model ? `${t.model.provider}/${t.model.modelId}` : undefined;
      attempt.startedAt = t.startedAt ?? t.createdAt;
      attempt.stoppedAt = t.completedAt ?? null;
      if (t.result) {
        attempt.result = t.result;
      }
      return state;
    },
    ctx,
  );
}
/**
 * Calls `onChange` after thread metadata changes, also from a different process. With `factory`, a change
 * of the factory status or owner also calls it. Session histories and logs do not call it. The watch waits
 * for 100 ms of quiet, and it does not keep the process alive. Returns the function that stops the watch.
 */
export async function watchThreads(
  onChange: () => void,
  ctx: ServiceContext = {},
  options: { factory?: boolean } = {},
): Promise<() => void> {
  const paths = await findProject(ctx);
  let timer: NodeJS.Timeout | undefined;
  // Watch the Project too, so the first runtime directory is observable without writes.
  const watcher = watch(paths.dir, { persistent: false, recursive: true }, (_event, file) => {
    const name = file?.toString() ?? "";
    const factory = name === "runtime/status.json" || name === "runtime/factory.lock" || name === "runtime";
    if (!name.startsWith("runtime/threads") && !(options.factory && factory)) {
      return;
    }
    clearTimeout(timer);
    timer = setTimeout(onChange, 100);
  });
  watcher.on("error", () => watcher.close());
  return () => {
    clearTimeout(timer);
    watcher.close();
  };
}
