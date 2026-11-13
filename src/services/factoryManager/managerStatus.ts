import { readFile } from "node:fs/promises";
import { evaluateScan, storyHash } from "../factoryPolicy/factoryPolicy.js";
import { readFactoryState } from "../factoryState/factoryState.js";
import { writeFileAtomic } from "../files/files.js";
import { runtimePath } from "../runtimeFiles/runtimeFiles.js";
import { listStages, type Stage } from "../stage/stage.js";
import { searchStories } from "../story/story.js";
import { promptHash } from "../supervisorDigest/supervisorDigest.js";
import { listThreads } from "../thread/thread.js";
import { type Hold, type ManagerState, notify, type ProviderPause } from "./managerState.js";

/** Policy reasons for Stories that wait for no worker. The status file leaves them out of its queue. */
const QUIET_REASONS = new Set(["hold stage", "stage unavailable"]);

type StoredPrompts = Record<string, { hash: string; class: string }>;
type CancelledStories = Record<string, { stage: string; hash: string }>;

/** Restores the delivery and hold state from the previous status file. */
export async function loadStoredStatus(manager: ManagerState): Promise<void> {
  try {
    const stored = JSON.parse(await readFile(await runtimePath(manager.paths, "status.json"), "utf8"));

    if (Array.isArray(stored.attention)) {
      for (const entry of stored.attention) {
        if (Array.isArray(entry) && typeof entry[0] === "string" && typeof entry[1]?.text === "string") {
          manager.attention.set(entry[0], entry[1]);
        }
      }
    }

    if (Array.isArray(stored.deliveredReportIds)) {
      const ids = stored.deliveredReportIds.filter((id: unknown) => typeof id === "string").slice(-100);

      manager.deliveredReportIds.push(...ids);
    }

    manager.attemptedHash = typeof stored.lastDigestHash === "string" ? stored.lastDigestHash : undefined;
    manager.unanswered = Number.isSafeInteger(stored.unanswered) ? Math.min(6, Math.max(0, stored.unanswered)) : 0;
    manager.nextWakeAt = typeof stored.nextWakeAt === "number" ? stored.nextWakeAt : 0;

    for (const [key, value] of Object.entries(stored.holds ?? {})) {
      manager.holds.set(key, value as Hold);
    }

    for (const [key, value] of Object.entries(stored.providers ?? {})) {
      manager.providers.set(key, value as ProviderPause);
    }
  } catch {
    /* Recompute status when the prior snapshot is absent or invalid. */
  }
}

function classifyPrompt(stage: Stage, prompts: StoredPrompts): string {
  if (!stage.prompt.trim()) {
    return "invalid";
  }

  if (["BACKLOG", "DONE"].includes(stage.key)) {
    return "hold";
  }

  if (prompts[stage.key]?.hash === promptHash(stage.prompt)) {
    return prompts[stage.key].class;
  }

  return "unclassified";
}

/** Lists the Stages with the hash and the stored class of each prompt. */
export async function classifiedStages(manager: ManagerState) {
  const state = await readFactoryState(manager.paths.root, manager.ctx);
  const prompts = (state.prompts ?? {}) as StoredPrompts;
  const stages = await listStages(manager.ctx);

  return stages.map((stage) => ({
    ...stage,
    promptHash: promptHash(stage.prompt),
    promptClass: classifyPrompt(stage, prompts),
  }));
}

/** Evaluates the policy, then skips Stories that the user cancelled or the supervisor holds. */
export async function scan(manager: ManagerState, maxActive = manager.limit) {
  const stories = await searchStories({}, manager.ctx);
  const stages = await classifiedStages(manager);
  const state = await readFactoryState(manager.paths.root, manager.ctx);

  const policy = evaluateScan(state, { stories, stages, maxActive });
  const cancelled = (state.nativeCancelled ?? {}) as CancelledStories;

  for (const decision of policy.decisions) {
    const story = stories.find((s) => s.id === decision.story);

    if (story && cancelled[story.id]?.stage === story.stage && cancelled[story.id]?.hash === storyHash(story)) {
      decision.action = "skip";
      decision.reason = "cancelled by user";
    }
  }

  for (const decision of policy.decisions) {
    const hold = manager.holds.get(decision.story);

    if (hold && hold.stage === decision.stage && Date.parse(hold.reconsiderAt) > Date.now()) {
      decision.action = "skip";
      decision.reason = `held: ${hold.reason}`;
    }
  }

  return policy;
}

/** Builds one page of the factory status for the supervisor tool and the status file. */
export async function buildSnapshot(manager: ManagerState, cursor = 0, pageLimit = 12) {
  const policy = await scan(manager);
  const { threads, issues } = await listThreads({}, manager.ctx);

  const workers = threads.filter((t) => t.role === "worker" && t.runs.at(-1)?.ownerToken === manager.owner.token);
  const pageEnd = cursor + pageLimit;

  return {
    version: 1,
    owner: manager.owner,
    phase: manager.phase,
    revision: ++manager.revision,
    heartbeatAt: new Date().toISOString(),
    supervisorThreadId: manager.supervisorId,
    workers: {
      running: workers.filter((t) => t.status === "running").length,
      pending: workers.filter((t) => t.status === "pending").length,
      waiting: policy.decisions.filter((d) => ["start", "retry"].includes(d.action)).length,
      limit: manager.limit,
    },
    decisions: policy.decisions.slice(cursor, pageEnd),
    nextCursor: policy.decisions.length > pageEnd ? pageEnd : null,
    attention: [...issues, ...manager.attention.entries()].slice(0, 12),
    providers: Object.fromEntries(manager.providers),
    holds: Object.fromEntries(manager.holds),
    deliveredReportIds: manager.deliveredReportIds.slice(-100),
    nextWakeAt: manager.nextWakeAt,
    lastDigestHash: manager.attemptedHash,
    unanswered: manager.unanswered,
    threads: threads
      .slice(-12)
      .map((t) => ({ id: t.id, storyId: t.storyId, stage: t.stage, status: t.status, result: t.result })),
  };
}

/** Writes status.json and sets a timer for the next hold, pause or retry deadline. */
export async function persistStatus(manager: ManagerState): Promise<void> {
  clearTimeout(manager.deadlineTimer);

  const policy = await scan(manager);
  const deadlines = [
    manager.nextWakeAt,
    ...[...manager.holds.values()].map((h) => Date.parse(h.reconsiderAt)),
    ...[...manager.providers.values()].map((p) => Date.parse(p.retryAt ?? "")),
    ...policy.decisions.map((d) => Date.parse(d.retryAt ?? "")),
  ].filter((t) => Number.isFinite(t) && t > Date.now());

  if (!manager.stopping && deadlines.length) {
    manager.deadlineTimer = setTimeout(() => notify(manager), Math.max(1, Math.min(...deadlines) - Date.now()));
    manager.deadlineTimer.unref();
  }

  // The TUI shows the queued work and its reasons. The supervisor reads decisions through its paged tool.
  const queue = policy.decisions
    .filter((d) => d.action !== "skip" || !QUIET_REASONS.has(d.reason))
    .slice(0, 50)
    .map((d) => ({ story: d.story, stage: d.stage, action: d.action, reason: d.reason, retryAt: d.retryAt }));
  const status = { ...(await buildSnapshot(manager)), queue };

  await writeFileAtomic(await runtimePath(manager.paths, "status.json"), `${JSON.stringify(status)}\n`, {
    mode: 0o600,
    durable: true,
  });
}
