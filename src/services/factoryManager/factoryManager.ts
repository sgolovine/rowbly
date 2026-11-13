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
  type Owner,
  probeOwner,
  readFactoryOwner,
  releaseFactoryOwnership,
} from "../factoryOwnership/factoryOwnership.js";
import { evaluateScan, markReported, pendingReports, releaseStory, storyHash } from "../factoryPolicy/factoryPolicy.js";
import { recoverFactory } from "../factoryRecovery/factoryRecovery.js";
import { getFactorySettings, type ModelChoice } from "../factorySettings/factorySettings.js";
import { readFactoryState, updateFactoryState } from "../factoryState/factoryState.js";
import { createResultTool, workerMessage } from "../factoryWorker/factoryWorker.js";
import { writeFileAtomic } from "../files/files.js";
import { openFactorySession } from "../piRuntime/factorySession.js";
import type { PiSession } from "../piRuntime/piRuntime.js";
import { commitCanonicalProject, projectWrite } from "../projectWrite/projectWrite.js";
import { runtimePath } from "../runtimeFiles/runtimeFiles.js";
import { bundledSkills } from "../skill/skill.js";
import { listStages } from "../stage/stage.js";
import { getStory, searchStories, updateStory } from "../story/story.js";
import { watchStories } from "../storyWatch/storyWatch.js";
import { promptHash, supervisorDigest } from "../supervisorDigest/supervisorDigest.js";
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
  ownership?: { owner: Owner; deadToken?: string };
  adoptExternal?: boolean;
  agentDir: string;
  shim: string;
  skillsDir: string;
  maxWorkers?: number;
  beforeLaunch?: (thread: ThreadRecord) => Promise<void>;
  onModel?: (role: string, model: ModelChoice) => void;
}
/** Policy reasons for Stories that wait for no worker. The status file leaves them out of its queue. */
const QUIET_REASONS = new Set(["hold stage", "stage unavailable"]);
export type FactoryManager = Awaited<ReturnType<typeof createFactoryManager>>;
/** Serializes lifecycle changes and reserves worker slots before asynchronous preparation. */
export async function createFactoryManager(deps: FactoryDependencies, context: ServiceContext = {}) {
  const paths = await findProject(context);
  const ctx = { ...context, cwd: paths.root };
  const previous = deps.ownership ? undefined : await readFactoryOwner(paths);
  const deadToken =
    deps.ownership?.deadToken ?? (previous && (await probeOwner(previous)) === "dead" ? previous.token : undefined);
  const owner = deps.ownership?.owner ?? (await newOwner());
  if (deps.ownership) await assertFactoryOwnership(paths, owner.token);
  else if (!(await acquireFactoryOwnership(paths, owner)).acquired)
    throw new ConflictError("Another factory owns this Project");
  let externalActive = 0;
  try {
    externalActive = (await recoverFactory(owner.token, deadToken, !!deps.adoptExternal, ctx)).externalActive;
  } catch (error) {
    await releaseFactoryOwnership(paths, owner.token);
    throw error;
  }
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
  const promptClaims = new Map<string, string>();
  const requests = new Map<string, string>();
  let stopping = false;
  let loopDone = Promise.resolve();
  let finishLoop = () => {};
  let loopStarted = false;
  let supervisor: PiSession | undefined;
  let supervisorId: string | undefined;
  let supervisorChoice: ModelChoice | undefined;
  let wake: (() => void) | undefined;
  let dirty = true;
  let revision = 0;
  let phase = "starting";
  let settings = await getFactorySettings(ctx).catch(async (error) => {
    await releaseFactoryOwnership(paths, owner.token);
    throw error;
  });
  let limit = deps.maxWorkers ?? settings.maxWorkers;
  if (!Number.isInteger(limit) || limit < 1) {
    await releaseFactoryOwnership(paths, owner.token);
    throw new ConflictError("Invalid worker limit");
  }
  let unwatch: (() => void) | undefined;
  let timer: NodeJS.Timeout | undefined;
  let heartbeat: NodeJS.Timeout | undefined;
  let deadlineTimer: NodeJS.Timeout | undefined;
  let authStamp = await stat(join(deps.agentDir, "auth.json")).then(
    (s) => s.mtimeMs,
    () => 0,
  );
  let acknowledgedHash: string | undefined;
  let attemptedHash: string | undefined;
  let nextWakeAt = 0;
  let unanswered = 0;
  const deliveredReportIds: string[] = [];
  let wakeCount = 0;
  let supervisorBorn = Date.now();
  const holds = new Map<string, { stage: string; reason: string; reconsiderAt: string }>();
  const attention = new Map<string, { text: string; storyId?: string }>();
  const providers = new Map<string, { reason: string; retryAt?: string }>();
  if (externalActive)
    attention.set("external", {
      text: `${externalActive} external attempts remain protected. Stop external workers before --adopt-external.`,
    });
  try {
    const stored = JSON.parse(await readFile(await runtimePath(paths, "status.json"), "utf8"));
    if (Array.isArray(stored.attention))
      for (const entry of stored.attention)
        if (Array.isArray(entry) && typeof entry[0] === "string" && typeof entry[1]?.text === "string")
          attention.set(entry[0], entry[1]);
    if (Array.isArray(stored.deliveredReportIds))
      deliveredReportIds.push(...stored.deliveredReportIds.filter((id: unknown) => typeof id === "string").slice(-100));
    attemptedHash = typeof stored.lastDigestHash === "string" ? stored.lastDigestHash : undefined;
    unanswered = Number.isSafeInteger(stored.unanswered) ? Math.min(6, Math.max(0, stored.unanswered)) : 0;
    nextWakeAt = typeof stored.nextWakeAt === "number" ? stored.nextWakeAt : 0;
    for (const [key, value] of Object.entries(stored.holds ?? {}))
      holds.set(key, value as { stage: string; reason: string; reconsiderAt: string });
    for (const [key, value] of Object.entries(stored.providers ?? {}))
      providers.set(key, value as { reason: string; retryAt?: string });
  } catch {
    /* Recompute status when the prior snapshot is absent or invalid. */
  }
  function pauseForError(provider: string | undefined, error: unknown) {
    if (!provider) return;
    const message = error instanceof Error ? error.message : "";
    if (/quota|usage.limit|billing|429/i.test(message))
      providers.set(provider, { reason: "quota", retryAt: new Date(Date.now() + 15 * 60_000).toISOString() });
    else if (/oauth|unauthorized|authentication|401/i.test(message))
      providers.set(provider, { reason: "authentication" });
  }
  async function classifiedStages() {
    const state = await readFactoryState(paths.root, ctx);
    const prompts = (state.prompts ?? {}) as Record<string, { hash: string; class: string }>;
    return (await listStages(ctx)).map((s) => ({
      ...s,
      promptHash: promptHash(s.prompt),
      promptClass: !s.prompt.trim()
        ? "invalid"
        : ["BACKLOG", "DONE"].includes(s.key)
          ? "hold"
          : prompts[s.key]?.hash === promptHash(s.prompt)
            ? prompts[s.key].class
            : "unclassified",
    }));
  }
  function notify() {
    dirty = true;
    wake?.();
  }
  async function scan(maxActive = limit) {
    const stories = await searchStories({}, ctx);
    const stages = await classifiedStages();
    const state = await readFactoryState(paths.root, ctx);
    const policy = evaluateScan(state, { stories, stages, maxActive });
    const cancelled = (state.nativeCancelled ?? {}) as Record<string, { stage: string; hash: string }>;
    for (const decision of policy.decisions) {
      const story = stories.find((s) => s.id === decision.story);
      if (story && cancelled[story.id]?.stage === story.stage && cancelled[story.id]?.hash === storyHash(story)) {
        decision.action = "skip";
        decision.reason = "cancelled by user";
      }
    }
    for (const decision of policy.decisions) {
      const hold = holds.get(decision.story);
      if (hold && hold.stage === decision.stage && Date.parse(hold.reconsiderAt) > Date.now()) {
        decision.action = "skip";
        decision.reason = `held: ${hold.reason}`;
      }
    }
    return policy;
  }
  async function snapshot(cursor = 0, pageLimit = 12) {
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
      decisions: policy.decisions.slice(cursor, cursor + pageLimit),
      nextCursor: policy.decisions.length > cursor + pageLimit ? cursor + pageLimit : null,
      attention: [...issues, ...attention.entries()].slice(0, 12),
      providers: Object.fromEntries(providers),
      holds: Object.fromEntries(holds),
      deliveredReportIds: deliveredReportIds.slice(-100),
      nextWakeAt,
      lastDigestHash: attemptedHash,
      unanswered,
      threads: threads
        .slice(-12)
        .map((t) => ({ id: t.id, storyId: t.storyId, stage: t.stage, status: t.status, result: t.result })),
    };
  }
  async function persistStatus() {
    clearTimeout(deadlineTimer);
    const policy = await scan();
    const deadlines = [
      nextWakeAt,
      ...[...holds.values()].map((h) => Date.parse(h.reconsiderAt)),
      ...[...providers.values()].map((p) => Date.parse(p.retryAt ?? "")),
      ...policy.decisions.map((d) => Date.parse(d.retryAt ?? "")),
    ].filter((t) => Number.isFinite(t) && t > Date.now());
    if (!stopping && deadlines.length) {
      deadlineTimer = setTimeout(notify, Math.max(1, Math.min(...deadlines) - Date.now()));
      deadlineTimer.unref();
    }
    // The TUI shows the queued work and its reasons. The supervisor reads decisions through its paged tool.
    const queue = policy.decisions
      .filter((d) => d.action !== "skip" || !QUIET_REASONS.has(d.reason))
      .slice(0, 50)
      .map((d) => ({ story: d.story, stage: d.stage, action: d.action, reason: d.reason, retryAt: d.retryAt }));
    await writeFileAtomic(
      await runtimePath(paths, "status.json"),
      `${JSON.stringify({ ...(await snapshot()), queue })}\n`,
      {
        mode: 0o600,
        durable: true,
      },
    );
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
    let assignedProvider: string | undefined;
    let lastActivityAt = new Date().toISOString();
    let lastTool: string | undefined;
    let unsubscribe: (() => void) | undefined;
    let activityTimer: NodeJS.Timeout | undefined;
    try {
      const intent = await getThread(id, ctx);
      await deps.beforeLaunch?.(intent);
      if ((await getThread(id, ctx)).status !== "pending") return;
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
        choice: intent.model ?? settings.workerModel,
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
      assignedProvider = opened.model.provider;
      const entry = active.get(id);
      if (entry) entry.session = handle;
      deps.onModel?.("worker", opened.model);
      await serial(async () => {
        if (stopping) throw new ConflictError("Factory is stopping");
        const pause = providers.get(opened.model.provider);
        if (pause && (!pause.retryAt || Date.parse(pause.retryAt) > Date.now()))
          throw new ConflictError("Worker provider is paused");
        if ((await getStory({ id: story.id }, ctx)).stage !== intent.stage)
          throw new ConflictError("Story Stage changed before prompt");
        await change(id, "running", { model: opened.model, session: { id, file: opened.file } });
      });
      const stage = (await listStages(ctx)).find((s) => s.key === intent.stage);
      if (stage && promptClaims.get(id) !== promptHash(stage.prompt))
        throw new ConflictError("Stage prompt changed before launch");
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
      unsubscribe = handle.session.subscribe((event) => {
        lastActivityAt = new Date().toISOString();
        if (event.type === "tool_execution_start") lastTool = event.toolName;
      });
      let activityWritePending = false;
      activityTimer = setInterval(() => {
        if (activityWritePending) return;
        activityWritePending = true;
        void serial(async () => {
          if (!handle) return;
          const t = await getThread(id, ctx);
          if (!["running", "pending"].includes(t.status)) return;
          const stats = handle.session.getSessionStats();
          await change(id, t.status, {
            lastActivityAt,
            lastTool,
            usage: {
              ...stats.tokens,
              cost: stats.cost,
            },
          });
        })
          .catch(() => {})
          .finally(() => {
            activityWritePending = false;
          });
      }, 1000);
      activityTimer.unref();
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
        if (["interrupted", "cancelled"].includes((await getThread(id, ctx)).status)) return;
        const fresh = await getStory({ id: story.id }, ctx).catch(() => undefined);
        result ??= { outcome: "unknown", summary: "Worker stopped without a result", blockers: [], problems: [] };
        if (fresh?.stage === intent.stage)
          result.problems = [...result.problems.slice(0, 9), "Story remains in the assigned Stage"];
        await change(id, stopping ? "interrupted" : "completed", { result, resumable: stopping });
      });
    } catch (error) {
      await serial(async () => {
        pauseForError(assignedProvider, error);
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
      clearInterval(activityTimer);
      unsubscribe?.();
      if (handle) {
        const stats = handle.session.getSessionStats();
        await serial(async () => {
          const t = await getThread(id, ctx);
          await change(id, t.status, {
            lastActivityAt,
            lastTool,
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
      await handle?.close();
      await serial(async () => {
        active.delete(id);
        await persistStatus();
      });
      notify();
    }
  }
  async function reserveWorker(input: {
    storyId: string;
    stage: string;
    requestId: string;
    resumeThreadId?: string;
    model?: ModelChoice;
  }) {
    return serial(async () => {
      const prior = requests.get(input.requestId);
      if (prior) return { threadId: prior };
      if (stopping) throw new ConflictError("Factory is stopping");
      const { threads } = await listThreads({ role: "worker" }, ctx);
      if (threads.some((t) => t.storyId === input.storyId && ["pending", "running"].includes(t.status)))
        throw new ConflictError("Story already has an active worker");
      const story = await getStory({ id: input.storyId }, ctx);
      if (story.stage !== input.stage) throw new ConflictError("Story Stage changed");
      if (Math.max(active.size, threads.filter((t) => ["pending", "running"].includes(t.status)).length) >= limit)
        throw new ConflictError("Worker capacity is full");
      if (input.resumeThreadId) {
        const previous = await getThread(input.resumeThreadId, ctx);
        if (previous.runs.at(-1)?.id === input.requestId) return { threadId: previous.id };
        if (
          !previous.resumable ||
          previous.status === "completed" ||
          previous.runs.length >= 3 ||
          previous.storyId !== story.id ||
          previous.stage !== story.stage ||
          !previous.worktree
        )
          throw new ConflictError("Thread cannot resume in this Stage");
        await stat(previous.worktree);
        await updateFactoryState(
          paths.root,
          (state) => {
            const cancelled = { ...((state.nativeCancelled as object) ?? {}) } as Record<string, unknown>;
            delete cancelled[story.id];
            return { ...releaseStory(state, story.id), nativeCancelled: cancelled };
          },
          ctx,
        );
      }
      const choice = input.model ?? settings.workerModel;
      if (choice) {
        const { validateModelChoice } = await import("../agentAuth/agentAuth.js");
        await validateModelChoice(deps.runtime, choice);
      }
      const pause = choice && providers.get(choice.provider);
      if (pause && (!pause.retryAt || Date.parse(pause.retryAt) > Date.now()))
        throw new ConflictError("Worker provider is paused");
      const policy = await scan(Number.MAX_SAFE_INTEGER);
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
        t = await appendThreadRun(
          previous.id,
          { expectedRevision: previous.revision, ownerToken: owner.token, runId: input.requestId },
          ctx,
        );
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
      if (choice) t = await change(t.id, "pending", { model: choice });
      await projectNativeAttempt(t.id, ctx);
      promptClaims.set(t.id, (await classifiedStages()).find((s) => s.key === story.stage)?.promptHash ?? "");
      requests.set(input.requestId, t.id);
      const entry = { task: Promise.resolve() };
      active.set(t.id, entry);
      entry.task = Promise.resolve().then(() => launch(t.id));
      await persistStatus();
      return { threadId: t.id };
    });
  }
  const textResult = (value: unknown) => ({
    content: [
      {
        type: "text" as const,
        text:
          JSON.stringify(value)?.length > 16_000
            ? JSON.stringify({ truncated: true, text: JSON.stringify(value).slice(0, 12_000) })
            : JSON.stringify(value),
      },
    ],
    details: {},
  });
  const tools = [
    {
      name: "factory_snapshot",
      label: "Factory snapshot",
      description: "Read bounded policy decisions and worker metadata",
      parameters: Type.Object({
        cursor: Type.Optional(Type.Integer({ minimum: 0 })),
        limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 12 })),
      }),
      execute: async (_id: string, args: { cursor?: number; limit?: number }) =>
        textResult(await serial(() => snapshot(args.cursor, args.limit))),
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
        model: Type.Optional(
          Type.Object({
            provider: Type.String(),
            modelId: Type.String(),
            thinkingLevel: Type.Optional(
              Type.Union([
                Type.Literal("off"),
                Type.Literal("minimal"),
                Type.Literal("low"),
                Type.Literal("medium"),
                Type.Literal("high"),
                Type.Literal("xhigh"),
                Type.Literal("max"),
              ]),
            ),
          }),
        ),
      }),
      execute: async (
        _id: string,
        args: { storyId: string; stage: string; requestId: string; resumeThreadId?: string; model?: ModelChoice },
      ) => textResult(await reserveWorker(args)),
    },
    {
      name: "inspect_worker",
      label: "Inspect worker",
      description: "Read metadata; request bounded history explicitly",
      parameters: Type.Object({
        threadId: Type.String(),
        history: Type.Optional(Type.Boolean()),
        limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 20 })),
      }),
      execute: async (_id: string, args: { threadId: string; history?: boolean; limit?: number }) =>
        textResult(
          args.history
            ? {
                thread: await getThread(args.threadId, ctx),
                history: JSON.stringify(await getThreadLog(args.threadId, { tail: args.limit ?? 20 }, ctx)).slice(
                  0,
                  4096,
                ),
              }
            : await getThread(args.threadId, ctx),
        ),
    },
    {
      name: "story_get",
      label: "Read Story",
      description: "Read a bounded current Story",
      parameters: Type.Object({ storyId: Type.String() }),
      execute: async (_id: string, args: { storyId: string }) =>
        textResult(JSON.stringify(await getStory({ id: args.storyId }, ctx)).slice(0, 8192)),
    },
    {
      name: "stage_get",
      label: "Read Stage",
      description: "Read the prompt and its current hash",
      parameters: Type.Object({ stage: Type.String() }),
      execute: async (_id: string, args: { stage: string }) => {
        const stage = (await classifiedStages()).find((s) => s.key === args.stage);
        return textResult(
          stage ? { ...stage, prompt: stage.prompt.slice(0, 8192), truncated: stage.prompt.length > 8192 } : null,
        );
      },
    },
    {
      name: "classify_stage",
      label: "Classify Stage",
      description: "Classify only the current prompt hash",
      parameters: Type.Object({
        stage: Type.String(),
        promptHash: Type.String(),
        class: Type.Union([Type.Literal("work"), Type.Literal("hold"), Type.Literal("invalid")]),
      }),
      execute: async (_id: string, args: { stage: string; promptHash: string; class: string }) =>
        textResult(
          await serial(async () => {
            const stage = (await classifiedStages()).find((s) => s.key === args.stage);
            if (!stage?.enabled || stage.promptHash !== args.promptHash)
              throw new ConflictError("Stage prompt changed");
            await updateFactoryState(
              paths.root,
              (state) => ({
                ...state,
                prompts: {
                  ...((state.prompts as object) ?? {}),
                  [args.stage]: { hash: args.promptHash, class: args.class },
                },
              }),
              ctx,
            );
            notify();
            return { classified: args.stage };
          }),
        ),
    },
    {
      name: "release_story",
      label: "Release Story",
      description: "Release policy parking and holds",
      parameters: Type.Object({ storyId: Type.String() }),
      execute: async (_id: string, args: { storyId: string }) =>
        textResult(
          await serial(async () => {
            holds.delete(args.storyId);
            await updateFactoryState(paths.root, (state) => releaseStory(state, args.storyId), ctx);
            notify();
            return { released: args.storyId };
          }),
        ),
    },
    {
      name: "save_note",
      label: "Save note",
      description: "Save a bounded operational note",
      parameters: Type.Object({ text: Type.String({ minLength: 1, maxLength: 1000 }) }),
      execute: async (_id: string, args: { text: string }) =>
        textResult(
          await serial(async () => {
            await updateFactoryState(
              paths.root,
              (state) => ({
                ...state,
                notes: [...(Array.isArray(state.notes) ? state.notes.slice(-11) : []), args.text],
              }),
              ctx,
            );
            return { saved: true };
          }),
        ),
    },
    {
      name: "clear_notes",
      label: "Clear notes",
      description: "Clear operational notes",
      parameters: Type.Object({}),
      execute: async () =>
        textResult(
          await serial(async () => {
            await updateFactoryState(paths.root, (state) => ({ ...state, notes: [] }), ctx);
            return { cleared: true };
          }),
        ),
    },
    {
      name: "hold_candidate",
      label: "Hold candidate",
      description: "Hold a current Story for at most thirty minutes",
      parameters: Type.Object({
        storyId: Type.String(),
        stage: Type.String(),
        reason: Type.String({ maxLength: 500 }),
        reconsiderAt: Type.String(),
      }),
      execute: async (_id: string, args: { storyId: string; stage: string; reason: string; reconsiderAt: string }) =>
        textResult(
          await serial(async () => {
            const deadline = Date.parse(args.reconsiderAt);
            if (!Number.isFinite(deadline) || deadline <= Date.now() || deadline > Date.now() + 30 * 60_000)
              throw new ConflictError("Invalid hold deadline");
            if ((await getStory({ id: args.storyId }, ctx)).stage !== args.stage)
              throw new ConflictError("Story Stage changed");
            holds.set(args.storyId, args);
            await persistStatus();
            return { held: args.storyId };
          }),
        ),
    },
    {
      name: "raise_attention",
      label: "Raise attention",
      description: "Record a bounded problem and continue other work",
      parameters: Type.Object({
        key: Type.String({ maxLength: 128 }),
        text: Type.String({ maxLength: 1000 }),
        storyId: Type.Optional(Type.String()),
      }),
      execute: async (_id: string, args: { key: string; text: string; storyId?: string }) =>
        textResult(
          await serial(async () => {
            if (!attention.has(args.key) && attention.size >= 100)
              throw new ConflictError("Attention capacity is full");
            attention.set(args.key, { text: args.text, storyId: args.storyId });
            await persistStatus();
            return { saved: true };
          }),
        ),
    },
    {
      name: "stop_worker",
      label: "Stop worker",
      description: "Interrupt only the expected active run",
      parameters: Type.Object({
        threadId: Type.String(),
        expectedRunId: Type.String(),
        reason: Type.String({ maxLength: 500 }),
      }),
      execute: async (_id: string, args: { threadId: string; expectedRunId: string; reason: string }) => {
        const session = await serial(async () => {
          const t = await getThread(args.threadId, ctx);
          if (t.runs.at(-1)?.id !== args.expectedRunId || !active.has(t.id))
            throw new ConflictError("Worker run changed");
          await change(t.id, "interrupted", { resumable: !!t.session.file });
          return active.get(t.id)?.session;
        });
        await session?.session.abort();
        return textResult({ interrupted: args.threadId });
      },
    },
  ];
  async function digest() {
    const policy = await scan();
    const state = await readFactoryState(paths.root, ctx);
    const stages = await classifiedStages();
    const reports = pendingReports(state);
    const { threads } = await listThreads({}, ctx);
    const candidates = policy.decisions.filter((d) => ["start", "retry"].includes(d.action));
    const stories = await searchStories({}, ctx);
    const unclassified = stages.filter(
      (s) => s.enabled && s.promptClass === "unclassified" && stories.some((story) => story.stage === s.key),
    );
    const material = candidates.length > 0 || unclassified.length > 0 || reports.length > 0;
    const digest = supervisorDigest({
      settings,
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
      holds: [...holds.entries()],
      providers: [...providers.entries()],
      attention: [...attention.entries()],
    });
    return { ...digest, reports: reports.slice(0, digest.deliveredCounts.reports ?? 0), material };
  }
  async function openSupervisor(parentThreadId?: string) {
    const t = await serial(() =>
      createThread({ role: "supervisor", cwd: paths.root, ownerToken: owner.token, parentThreadId }, ctx),
    );
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
    supervisorChoice = opened.model;
    deps.onModel?.("supervisor", opened.model);
    await serial(() => change(t.id, "running", { model: opened.model, session: { id: t.id, file: opened.file } }));
    supervisorBorn = Date.now();
    wakeCount = 0;
  }
  async function run() {
    if (stopping) return;
    if (loopStarted) throw new ConflictError("Factory loop is already running");
    loopStarted = true;
    loopDone = new Promise<void>((resolve) => {
      finishLoop = resolve;
    });
    try {
      await openSupervisor();
      phase = "ready";
      heartbeat = setInterval(() => {
        void serial(persistStatus).catch(() => {});
      }, 5000);
      heartbeat.unref();
      if (stopping) return;
      unwatch = await watchStories(notify, ctx, { includeState: false });
      timer = setInterval(notify, 30_000);
      timer.unref();
      await serial(persistStatus);
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
        try {
          await serial(async () => {
            const policy = await scan();
            await updateFactoryState(paths.root, () => policy.state, ctx);
          });
          const freshSettings = await getFactorySettings(ctx).catch(() => settings);
          settings = freshSettings;
          limit = deps.maxWorkers ?? settings.maxWorkers;
          const currentAuthStamp = await stat(join(deps.agentDir, "auth.json")).then(
            (s) => s.mtimeMs,
            () => 0,
          );
          if (currentAuthStamp !== authStamp) {
            authStamp = currentAuthStamp;
            for (const [provider, pause] of providers)
              if (pause.reason === "authentication") providers.delete(provider);
          }
          for (const [provider, pause] of providers)
            if (pause.retryAt && Date.parse(pause.retryAt) <= Date.now()) providers.delete(provider);
          const committed = await commitCanonicalProject(paths.root);
          if (!["clean", "committed"].includes(committed.status))
            attention.set("commit", { text: `Canonical commit: ${committed.status}` });
          if (stopping) break;
          const delivery = await digest();
          const supervisorProvider = settings.supervisorModel?.provider ?? supervisorChoice?.provider;
          const supervisorPause = supervisorProvider && providers.get(supervisorProvider);
          if (!delivery.material || supervisorPause || (delivery.hash === attemptedHash && Date.now() < nextWakeAt)) {
            await serial(persistStatus);
            continue;
          }
          if (
            (settings.supervisorModel &&
              JSON.stringify(settings.supervisorModel) !== JSON.stringify(supervisorChoice)) ||
            wakeCount >= 50 ||
            Date.now() - supervisorBorn >= 24 * 60 * 60_000 ||
            (supervisor?.session.getContextUsage()?.percent ?? 0) > 50
          ) {
            await supervisor?.close();
            const previous = supervisorId;
            if (previous) await serial(() => change(previous, "completed"));
            await openSupervisor(previous);
          }
          try {
            attemptedHash = delivery.hash;
            nextWakeAt = Date.now() + 60_000;
            await serial(persistStatus);
            const instructions = (await readFile(paths.instructionsFile, "utf8").catch(() => "")).slice(0, 16_000);
            await supervisor?.sendDigest(`${contract}\n${instructions}\n${delivery.text}`);
            wakeCount++;
            unanswered = acknowledgedHash === delivery.hash ? unanswered + 1 : 0;
            acknowledgedHash = delivery.hash;
            deliveredReportIds.push(...delivery.reports.map((r) => promptHash(JSON.stringify(r))));
            deliveredReportIds.splice(0, Math.max(0, deliveredReportIds.length - 100));
            await serial(async () => {
              await updateFactoryState(
                paths.root,
                (state) => delivery.reports.reduce((current, report) => markReported(current, report), state),
                ctx,
              );
            });
            nextWakeAt = Date.now() + Math.min(30 * 60_000, 30_000 * 2 ** Math.min(unanswered, 6));
          } catch (error) {
            if (!stopping) {
              pauseForError(supervisorChoice?.provider, error);
              attention.set("supervisor", { text: "Supervisor turn failed; retry after backoff" });
              nextWakeAt = Date.now() + 60_000;
            }
          }
          if (stopping) break;
          await serial(persistStatus);
        } catch {
          if (!stopping) {
            attention.set("reconcile", { text: "Project reconciliation failed; retry on the next scan" });
            await serial(persistStatus).catch(() => {});
          }
        }
      }
    } finally {
      finishLoop?.();
      await shutdown();
    }
  }
  let shutdownTask: Promise<void> | undefined;
  function shutdown(): Promise<void> {
    shutdownTask ??= (async () => {
      stopping = true;
      unwatch?.();
      clearInterval(timer);
      clearInterval(heartbeat);
      clearTimeout(deadlineTimer);
      phase = "stopping";
      wake?.();
      await Promise.all([supervisor?.session.abort(), ...[...active.values()].map((a) => a.session?.session.abort())]);
      await loopDone;
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
      await deps.runtime.settleCredentialWrites();
      await releaseFactoryOwnership(paths, owner.token);
    })();
    return shutdownTask;
  }
  return {
    run,
    reserveWorker,
    cancelWorker: async (id: string, expectedRunId: string) => {
      const session = await serial(async () => {
        const t = await getThread(id, ctx);
        if (t.runs.at(-1)?.id !== expectedRunId || t.runs.at(-1)?.ownerToken !== owner.token)
          throw new ConflictError("Worker run changed");
        if (t.status === "cancelled") return undefined;
        if (!active.has(id) || !["pending", "running"].includes(t.status))
          throw new ConflictError("Worker is not active");
        const story = await getStory({ id: t.storyId as string }, ctx);
        await updateFactoryState(
          paths.root,
          (state) => ({
            ...state,
            nativeCancelled: {
              ...((state.nativeCancelled as object) ?? {}),
              [story.id]: { stage: story.stage, hash: storyHash(story) },
            },
          }),
          ctx,
        );
        await change(id, "cancelled", { resumable: !!t.session.file });
        return active.get(id)?.session;
      });
      await session?.session.abort();
    },
    resumeWorker: async (id: string, expectedRunId: string, requestId: string) => {
      const t = await getThread(id, ctx);
      if (t.runs.at(-1)?.id !== expectedRunId) {
        if (t.runs.at(-1)?.id && t.runs.at(-1)?.id === requestId) return;
        throw new ConflictError("Worker run changed");
      }
      await reserveWorker({ storyId: t.storyId as string, stage: t.stage as string, requestId, resumeThreadId: id });
    },
    retryProvider: (provider: string) =>
      serial(async () => {
        providers.delete(provider);
        nextWakeAt = 0;
        attemptedHash = undefined;
        await persistStatus();
        notify();
      }),
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
