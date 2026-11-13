import { readFile, stat } from "node:fs/promises";
import { join } from "node:path";
import type { ModelRuntime } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { getThreadLog } from "../conversation/conversation.js";
import { ConflictError } from "../errors/errors.js";
import {
  acquireFactoryOwnership,
  assertFactoryOwnership,
  newOwner,
  releaseFactoryOwnership,
} from "../factoryOwnership/factoryOwnership.js";
import { evaluateScan } from "../factoryPolicy/factoryPolicy.js";
import { getFactorySettings, type ModelChoice } from "../factorySettings/factorySettings.js";
import { readFactoryState, updateFactoryState } from "../factoryState/factoryState.js";
import { createResultTool, workerMessage } from "../factoryWorker/factoryWorker.js";
import { writeFileAtomic } from "../files/files.js";
import { openFactorySession } from "../piRuntime/factorySession.js";
import type { PiSession } from "../piRuntime/piRuntime.js";
import { projectWrite } from "../projectWrite/projectWrite.js";
import { runtimePath } from "../runtimeFiles/runtimeFiles.js";
import { bundledSkills } from "../skill/skill.js";
import { listStages } from "../stage/stage.js";
import { getStory, searchStories, updateStory } from "../story/story.js";
import {
  appendThreadRun,
  createThread,
  getThread,
  listThreads,
  projectNativeAttempt,
  type ThreadRecord,
  transitionThread,
  type WorkerResult,
} from "../thread/thread.js";
import { prepareWorkerWorktree } from "../workerWorktree/workerWorktree.js";
import { findProject, type ServiceContext } from "../workspace/workspace.js";

export interface FactoryDependencies {
  runtime: ModelRuntime;
  agentDir: string;
  shim: string;
  skillsDir: string;
  maxWorkers?: number;
  beforeLaunch?: (thread: ThreadRecord) => Promise<void>;
  onModel?: (role: string, model: ModelChoice) => void;
}
export type FactoryManager = Awaited<ReturnType<typeof createFactoryManager>>;
/** Serializes lifecycle changes and reserves worker slots before asynchronous preparation. */
export async function createFactoryManager(deps: FactoryDependencies, context: ServiceContext = {}) {
  const paths = await findProject(context);
  const ctx = { ...context, cwd: paths.root };
  const owner = await newOwner();
  if (!(await acquireFactoryOwnership(paths, owner)).acquired)
    throw new ConflictError("Another factory owns this Project");
  let queue: Promise<unknown> = Promise.resolve();
  function serial<T>(call: () => Promise<T>): Promise<T> {
    const next = queue.then(async () => {
      await assertFactoryOwnership(paths, owner.token);
      return call();
    });
    queue = next.catch(() => {});
    return next;
  }
  const active = new Map<string, { task: Promise<void>; session?: PiSession }>();
  const requests = new Map<string, string>();
  let stopping = false;
  let supervisor: PiSession | undefined;
  let supervisorId: string | undefined;
  let wake: (() => void) | undefined;
  let dirty = true;
  let revision = 0;
  let phase = "starting";
  const settings = await getFactorySettings(ctx).catch(async (error) => {
    await releaseFactoryOwnership(paths, owner.token);
    throw error;
  });
  const limit = deps.maxWorkers ?? settings.maxWorkers;
  if (!Number.isInteger(limit) || limit < 1) {
    await releaseFactoryOwnership(paths, owner.token);
    throw new ConflictError("Invalid worker limit");
  }
  function notify() {
    dirty = true;
    wake?.();
  }
  async function scan() {
    const stories = await searchStories({}, ctx);
    const stages = await listStages(ctx);
    const state = await readFactoryState(paths.root, ctx);
    // M5 accepts enabled nonterminal prompts as work. M7 adds hash-bound AI classifications.
    return evaluateScan(state, {
      stories,
      stages: stages.map((s) => ({
        ...s,
        promptClass: !s.prompt.trim() ? "missing" : ["BACKLOG", "DONE"].includes(s.key) ? "hold" : "work",
      })),
      maxActive: limit,
    });
  }
  async function snapshot() {
    const policy = await scan();
    const { threads, issues } = await listThreads({}, ctx);
    const workers = threads.filter((t) => t.role === "worker" && t.runs.at(-1)?.ownerToken === owner.token);
    return {
      version: 1,
      owner,
      phase,
      revision: ++revision,
      heartbeatAt: new Date().toISOString(),
      supervisorThreadId: supervisorId,
      workers: {
        running: workers.filter((t) => t.status === "running").length,
        pending: workers.filter((t) => t.status === "pending").length,
        waiting: policy.decisions.filter((d) => ["start", "retry"].includes(d.action)).length,
        limit,
      },
      decisions: policy.decisions.slice(0, 12),
      attention: issues,
      providers: {},
      holds: {},
      deliveredReportIds: [],
      threads: threads
        .slice(-12)
        .map((t) => ({ id: t.id, storyId: t.storyId, stage: t.stage, status: t.status, result: t.result })),
    };
  }
  async function persistStatus() {
    await writeFileAtomic(await runtimePath(paths, "status.json"), `${JSON.stringify(await snapshot())}\n`, {
      mode: 0o600,
      durable: true,
    });
  }
  async function change(
    id: string,
    status: ThreadRecord["status"],
    patch?: Parameters<typeof transitionThread>[1]["patch"],
  ) {
    const t = await getThread(id, ctx);
    const next = await transitionThread(id, { expectedRevision: t.revision, status, patch }, ctx);
    await projectNativeAttempt(id, ctx);
    return next;
  }
  async function launch(id: string) {
    let handle: PiSession | undefined;
    let reportedResult: WorkerResult | undefined;
    try {
      const intent = await getThread(id, ctx);
      await deps.beforeLaunch?.(intent);
      if (stopping) throw new ConflictError("Factory is stopping");
      const story = await getStory({ id: intent.storyId as string }, ctx);
      if (story.stage !== intent.stage) throw new ConflictError("Story Stage changed before launch");
      const worktree = await prepareWorkerWorktree(
        paths.root,
        intent.runs.length > 1 ? { ...story, fields: { ...story.fields, worktree: intent.worktree ?? null } } : story,
      );
      await serial(async () => {
        if (stopping) throw new ConflictError("Factory is stopping");
        const fresh = await getStory({ id: story.id }, ctx);
        if (fresh.stage !== intent.stage) throw new ConflictError("Story Stage changed before launch");
        await change(id, "pending", { cwd: worktree.path, worktree: worktree.path, branch: worktree.branch });
        if ("worktree" in fresh.fields)
          await projectWrite(paths.root, () => updateStory({ id: story.id, fields: { worktree: worktree.path } }, ctx));
      });
      const opened = await openFactorySession({
        thread: intent,
        runtimeDir: paths.runtimeDir,
        runtime: deps.runtime,
        agentDir: deps.agentDir,
        choice: intent.runs.length > 1 ? intent.model : settings.workerModel,
        worker: { cwd: worktree.path, root: paths.root, shim: deps.shim },
        tools: [
          createResultTool((result) =>
            serial(async () => {
              await change(id, "running", { result });
              reportedResult = result;
            }),
          ),
        ],
      });
      handle = opened.handle;
      const entry = active.get(id);
      if (entry) entry.session = handle;
      deps.onModel?.("worker", opened.model);
      await serial(async () => {
        if (stopping) throw new ConflictError("Factory is stopping");
        if ((await getStory({ id: story.id }, ctx)).stage !== intent.stage)
          throw new ConflictError("Story Stage changed before prompt");
        await change(id, "running", { model: opened.model, session: { id, file: opened.file } });
      });
      const stage = (await listStages(ctx)).find((s) => s.key === intent.stage);
      if (!stage?.enabled) throw new ConflictError("Stage is disabled");
      const prompt = await workerMessage({
        root: paths.root,
        story: story.id,
        stage: story.stage,
        prompt: stage.prompt,
        shim: deps.shim,
        worktree: worktree.path,
        model: `${opened.model.provider}/${opened.model.modelId}`,
        skillsDir: deps.skillsDir,
      });
      await handle.prompt(prompt);
      let result = reportedResult;
      if (!result && !stopping) {
        const fallback = handle.session.getLastAssistantText()?.match(/RESULT:\s*([^\n]+)\s*$/)?.[1];
        if (fallback) result = { outcome: fallback, summary: fallback.slice(0, 1000), blockers: [], problems: [] };
        else {
          await handle.prompt(
            "Call report_result now with the final outcome, summary, blockers and problems. Then stop.",
          );
          result = reportedResult;
        }
      }
      await serial(async () => {
        const fresh = await getStory({ id: story.id }, ctx).catch(() => undefined);
        result ??= { outcome: "unknown", summary: "Worker stopped without a result", blockers: [], problems: [] };
        if (fresh?.stage === intent.stage)
          result.problems = [...result.problems.slice(0, 9), "Story remains in the assigned Stage"];
        await change(id, stopping ? "interrupted" : "completed", { result, resumable: stopping });
      });
    } catch (error) {
      await serial(async () => {
        const t = await getThread(id, ctx);
        if (["pending", "running"].includes(t.status))
          await change(id, stopping ? "interrupted" : "failed", {
            resumable: !!t.session.file,
            error: {
              class: handle ? "unknown" : "launch",
              code: "WORKER_FAILED",
              message: (error instanceof Error ? error.message : "Worker failed").slice(0, 1000),
            },
          });
      });
    } finally {
      await handle?.close();
      await serial(async () => {
        active.delete(id);
        await persistStatus();
      });
      notify();
    }
  }
  async function reserveWorker(input: { storyId: string; stage: string; requestId: string; resumeThreadId?: string }) {
    return serial(async () => {
      const prior = requests.get(input.requestId);
      if (prior) return { threadId: prior };
      if (stopping) throw new ConflictError("Factory is stopping");
      const { threads } = await listThreads({ role: "worker" }, ctx);
      if (threads.some((t) => t.storyId === input.storyId && ["pending", "running"].includes(t.status)))
        throw new ConflictError("Story already has an active worker");
      if (Math.max(active.size, threads.filter((t) => ["pending", "running"].includes(t.status)).length) >= limit)
        throw new ConflictError("Worker capacity is full");
      const story = await getStory({ id: input.storyId }, ctx);
      if (story.stage !== input.stage) throw new ConflictError("Story Stage changed");
      const policy = await scan();
      const decision = policy.decisions.find((d) => d.story === story.id);
      if (!decision || !["start", "retry"].includes(decision.action))
        throw new ConflictError(`Story is not eligible: ${decision?.reason ?? "missing"}`);
      await updateFactoryState(paths.root, () => policy.state, ctx);
      let t: ThreadRecord;
      if (input.resumeThreadId) {
        const previous = await getThread(input.resumeThreadId, ctx);
        if (
          previous.role !== "worker" ||
          previous.storyId !== story.id ||
          previous.stage !== story.stage ||
          !previous.worktree ||
          !previous.resumable ||
          previous.status === "completed" ||
          previous.runs.length >= 3
        )
          throw new ConflictError("Thread cannot resume in this Stage");
        if (!(await stat(previous.worktree)).isDirectory()) throw new ConflictError("Resume worktree is unavailable");
        t = await appendThreadRun(previous.id, { expectedRevision: previous.revision, ownerToken: owner.token }, ctx);
      } else {
        t = await createThread(
          {
            role: "worker",
            storyId: story.id,
            stage: story.stage,
            cwd: paths.root,
            ownerToken: owner.token,
            parentThreadId: supervisorId,
            attemptNumber: decision.attempt ?? 1,
          },
          ctx,
        );
      }
      await projectNativeAttempt(t.id, ctx);
      requests.set(input.requestId, t.id);
      const entry = { task: Promise.resolve() };
      active.set(t.id, entry);
      entry.task = Promise.resolve().then(() => launch(t.id));
      await persistStatus();
      return { threadId: t.id };
    });
  }
  const textResult = (value: unknown) => ({
    content: [{ type: "text" as const, text: JSON.stringify(value) }],
    details: {},
  });
  const tools = [
    {
      name: "factory_snapshot",
      label: "Factory snapshot",
      description: "Read bounded policy decisions and worker metadata",
      parameters: Type.Object({}),
      execute: async () => textResult(await serial(snapshot)),
    },
    {
      name: "start_worker",
      label: "Start worker",
      description: "Reserve an eligible worker",
      parameters: Type.Object({
        storyId: Type.String(),
        stage: Type.String(),
        requestId: Type.String({ minLength: 1, maxLength: 128 }),
        resumeThreadId: Type.Optional(Type.String()),
      }),
      execute: async (
        _id: string,
        args: { storyId: string; stage: string; requestId: string; resumeThreadId?: string },
      ) => textResult(await reserveWorker(args)),
    },
    {
      name: "inspect_worker",
      label: "Inspect worker",
      description: "Read metadata; request bounded history explicitly",
      parameters: Type.Object({ threadId: Type.String(), history: Type.Optional(Type.Boolean()) }),
      execute: async (_id: string, args: { threadId: string; history?: boolean }) =>
        textResult(
          args.history
            ? {
                thread: await getThread(args.threadId, ctx),
                history: JSON.stringify(await getThreadLog(args.threadId, { tail: 20 }, ctx)).slice(0, 4096),
              }
            : await getThread(args.threadId, ctx),
        ),
    },
  ];
  async function run() {
    if (stopping) return;
    try {
      const t = await serial(() => createThread({ role: "supervisor", cwd: paths.root, ownerToken: owner.token }, ctx));
      supervisorId = t.id;
      const opened = await openFactorySession({
        thread: t,
        runtimeDir: paths.runtimeDir,
        agentDir: deps.agentDir,
        runtime: deps.runtime,
        choice: settings.supervisorModel,
        tools,
      });
      supervisor = opened.handle;
      deps.onModel?.("supervisor", opened.model);
      await serial(async () => {
        await change(t.id, "running", { model: opened.model, session: { id: t.id, file: opened.file } });
        phase = "ready";
        await persistStatus();
      });
      const instructions = await readFile(paths.instructionsFile, "utf8").catch(() => "");
      const contract = await readFile(
        join((await bundledSkills()).dir, "factory/references/supervisor-native.md"),
        "utf8",
      );
      while (!stopping) {
        if (!dirty) {
          await new Promise<void>((resolve) => {
            wake = resolve;
            if (dirty || stopping) resolve();
          });
          wake = undefined;
          continue;
        }
        dirty = false;
        await serial(async () => {
          const policy = await scan();
          await updateFactoryState(paths.root, () => policy.state, ctx);
        });
        try {
          await supervisor.prompt(`${contract}\n${instructions}\n${JSON.stringify(await serial(snapshot))}`);
        } catch (error) {
          if (!stopping) throw error;
        }
        if (stopping) break;
        await serial(persistStatus);
      }
    } finally {
      await shutdown();
    }
  }
  let shutdownTask: Promise<void> | undefined;
  function shutdown(): Promise<void> {
    shutdownTask ??= (async () => {
      stopping = true;
      phase = "stopping";
      wake?.();
      await Promise.all([supervisor?.session.abort(), ...[...active.values()].map((a) => a.session?.session.abort())]);
      await Promise.all([...active.values()].map((a) => a.task));
      await supervisor?.close();
      await serial(async () => {
        if (supervisorId) {
          const t = await getThread(supervisorId, ctx);
          if (["running", "pending"].includes(t.status))
            await change(t.id, "interrupted", { resumable: !!t.session.file });
        }
        phase = "stopped";
        await persistStatus();
      });
      await releaseFactoryOwnership(paths, owner.token);
    })();
    return shutdownTask;
  }
  return {
    run,
    reserveWorker,
    snapshot: () => serial(snapshot),
    reconcile: () =>
      serial(async () => {
        const policy = await scan();
        await updateFactoryState(paths.root, () => policy.state, ctx);
        return policy.decisions;
      }),
    shutdown,
    owner,
  };
}

/** Reads status without loading Pi or opening histories. */
export async function getFactoryStatus(ctx: ServiceContext = {}) {
  const paths = await findProject(ctx);
  try {
    return JSON.parse(await readFile(await runtimePath(paths, "status.json"), "utf8"));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return { version: 1, phase: "stopped" };
    throw error;
  }
}
