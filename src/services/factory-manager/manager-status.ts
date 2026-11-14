import { readFile } from "node:fs/promises";
import { checkQueueStatus } from "../check-queue/check-queue.js";
import { evaluateScan, storyHash } from "../factory-policy/factory-policy.js";
import { readFactoryState } from "../factory-state/factory-state.js";
import { writeFileAtomic } from "../files/files.js";
import { runtimePath } from "../runtime-files/runtime-files.js";
import { listStages, type Stage } from "../stage/stage.js";
import { type Story, searchStories } from "../story/story.js";
import { promptHash } from "../supervisor-digest/supervisor-digest.js";
import { listThreads } from "../thread/thread.js";
import type { ProjectPaths } from "../workspace/workspace.js";
import {
  type Attention,
  getState,
  type Hold,
  type Manager,
  type ManagerState,
  notify,
  type ProviderPause,
  setState,
} from "./manager-state.js";

/** Policy reasons for Stories that wait for no worker. The status file leaves them out of its queue. */
const QUIET_REASONS = new Set(["hold stage", "stage unavailable"]);

type StoredPrompts = Record<string, { hash: string; class: string }>;
type CancelledStories = Record<string, { stage: string; hash: string }>;
type ScanResult = ReturnType<typeof evaluateScan>;
type Decision = ScanResult["decisions"][number];

/** The part of the state that a new manager restores from the previous status file. */
export type StoredStatus = Partial<
  Pick<
    ManagerState,
    "attention" | "deliveredReportIds" | "attemptedHash" | "unanswered" | "nextWakeAt" | "holds" | "providers"
  >
>;

/** Reads the delivery and hold state of the previous status file. An absent or invalid file gives no state. */
export async function loadStoredStatus(paths: ProjectPaths): Promise<StoredStatus> {
  try {
    const stored = JSON.parse(await readFile(await runtimePath(paths, "status.json"), "utf8"));

    const attention: [string, Attention][] = Array.isArray(stored.attention)
      ? stored.attention.filter(
          (entry: unknown) =>
            Array.isArray(entry) && typeof entry[0] === "string" && typeof entry[1]?.text === "string",
        )
      : [];
    const deliveredReportIds: string[] = Array.isArray(stored.deliveredReportIds)
      ? stored.deliveredReportIds.filter((id: unknown) => typeof id === "string").slice(-100)
      : [];

    return {
      attention: new Map(attention),
      deliveredReportIds,
      attemptedHash: typeof stored.lastDigestHash === "string" ? stored.lastDigestHash : undefined,
      unanswered: Number.isSafeInteger(stored.unanswered) ? Math.min(6, Math.max(0, stored.unanswered)) : 0,
      nextWakeAt: typeof stored.nextWakeAt === "number" ? stored.nextWakeAt : 0,
      holds: new Map(Object.entries(stored.holds ?? {}) as [string, Hold][]),
      providers: new Map(Object.entries(stored.providers ?? {}) as [string, ProviderPause][]),
    };
  } catch {
    return {};
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
export async function classifiedStages(manager: Manager) {
  const state = await readFactoryState(manager.paths.root, manager.ctx);
  const prompts = (state.prompts ?? {}) as StoredPrompts;
  const stages = await listStages(manager.ctx);

  return stages.map((stage) => ({
    ...stage,
    promptHash: promptHash(stage.prompt),
    promptClass: classifyPrompt(stage, prompts),
  }));
}

/** Gives the reason to skip a Story that the user cancelled or the supervisor holds, or undefined. */
function skipReason(
  decision: Decision,
  story: Story | undefined,
  cancelled: CancelledStories,
  hold: Hold | undefined,
): string | undefined {
  if (hold && hold.stage === decision.stage && Date.parse(hold.reconsiderAt) > Date.now()) {
    return `held: ${hold.reason}`;
  }

  if (story && cancelled[story.id]?.stage === story.stage && cancelled[story.id]?.hash === storyHash(story)) {
    return "cancelled by user";
  }

  return undefined;
}

/** Evaluates the policy, then skips Stories that the user cancelled or the supervisor holds. */
export async function scan(manager: Manager, maxActive = getState(manager).limit): Promise<ScanResult> {
  const stories = await searchStories({}, manager.ctx);
  const stages = await classifiedStages(manager);
  const state = await readFactoryState(manager.paths.root, manager.ctx);

  const policy = evaluateScan(state, { stories, stages, maxActive });
  const cancelled = (state.nativeCancelled ?? {}) as CancelledStories;
  const { holds } = getState(manager);

  const decisions = policy.decisions.map((decision) => {
    const story = stories.find((s) => s.id === decision.story);
    const reason = skipReason(decision, story, cancelled, holds.get(decision.story));

    return reason ? { ...decision, action: "skip" as const, reason } : decision;
  });

  return { ...policy, decisions };
}

/** Builds one page of the factory status for the supervisor tool and the status file. */
export async function buildSnapshot(manager: Manager, cursor = 0, pageLimit = 12) {
  const policy = await scan(manager);
  const { threads, issues } = await listThreads({}, manager.ctx);

  const state = setState(manager, (current) => ({ revision: current.revision + 1 }));
  const workers = threads.filter((t) => t.role === "worker" && t.runs.at(-1)?.ownerToken === manager.owner.token);
  const pageEnd = cursor + pageLimit;

  return {
    version: 1,
    owner: manager.owner,
    phase: state.phase,
    revision: state.revision,
    heartbeatAt: new Date().toISOString(),
    supervisorThreadId: state.supervisorId,
    workers: {
      running: workers.filter((t) => t.status === "running").length,
      pending: workers.filter((t) => t.status === "pending").length,
      waiting: policy.decisions.filter((d) => ["start", "retry"].includes(d.action)).length,
      limit: state.limit,
    },
    decisions: policy.decisions.slice(cursor, pageEnd),
    nextCursor: policy.decisions.length > pageEnd ? pageEnd : null,
    attention: [...issues, ...state.attention.entries()].slice(0, 12),
    providers: Object.fromEntries(state.providers),
    holds: Object.fromEntries(state.holds),
    deliveredReportIds: state.deliveredReportIds.slice(-100),
    nextWakeAt: state.nextWakeAt,
    lastDigestHash: state.attemptedHash,
    unanswered: state.unanswered,
    ...(state.settings.checks ? { checks: checkQueueStatus(manager.checks) } : {}),
    threads: threads
      .slice(-12)
      .map((t) => ({ id: t.id, storyId: t.storyId, stage: t.stage, status: t.status, result: t.result })),
  };
}

/** Gives the next hold, pause, retry or wake deadline in the future, or undefined. */
function nextDeadline(state: Readonly<ManagerState>, decisions: readonly Decision[]): number | undefined {
  const deadlines = [
    state.nextWakeAt,
    ...[...state.holds.values()].map((h) => Date.parse(h.reconsiderAt)),
    ...[...state.providers.values()].map((p) => Date.parse(p.retryAt ?? "")),
    ...decisions.map((d) => Date.parse(d.retryAt ?? "")),
  ].filter((t) => Number.isFinite(t) && t > Date.now());

  return deadlines.length ? Math.min(...deadlines) : undefined;
}

/** Writes status.json and sets a timer for the next hold, pause or retry deadline. */
export async function persistStatus(manager: Manager): Promise<void> {
  clearTimeout(getState(manager).deadlineTimer);

  const policy = await scan(manager);
  const deadline = nextDeadline(getState(manager), policy.decisions);

  if (!getState(manager).stopping && deadline !== undefined) {
    const deadlineTimer = setTimeout(() => notify(manager), Math.max(1, deadline - Date.now()));

    deadlineTimer.unref();
    setState(manager, () => ({ deadlineTimer }));
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
