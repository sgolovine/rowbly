import { readFile } from "node:fs/promises";
import { checkQueueStatus } from "../check-queue/check-queue.js";
import { evaluateScan, HOST_SYNC_REASON, promptHash, storyHash } from "../factory-policy/factory-policy.js";
import { stageClassOf } from "../factory-settings/stage-classes.js";
import { selectWorkerModel, type WorkerSelection } from "../factory-settings/worker-overrides.js";
import { readFactoryState } from "../factory-state/factory-state.js";
import { writeFileAtomic } from "../files/files.js";
import { runtimePath } from "../runtime-files/runtime-files.js";
import { listStages } from "../stage/stage.js";
import { type Story, searchStories } from "../story/story.js";
import { listThreads } from "../thread/thread.js";
import type { ProjectPaths } from "../workspace/workspace.js";
import { connectivityOf } from "./connectivity.js";
import { dependencyLists } from "./dependency-facts.js";
import { withContactFacts } from "./host-slots.js";
import {
  type Attention,
  getState,
  isProviderPaused,
  type Manager,
  type ManagerState,
  notify,
  type ProviderPause,
  setState,
} from "./manager-state.js";
import { networkWaitingThreads } from "./network-wait.js";
import { managerCapacity, managerSlots } from "./worker-placement.js";

/** The skip reason of a Story whose worker Thread waits for its provider, to resume after a network pause. */
export const NETWORK_WAIT_REASON = "waiting for network resume";

/** The skip reason of a Story whose worker model and fallback models all have a paused provider. */
const PROVIDER_PAUSED_REASON = "provider paused";

/** Policy reasons for Stories that wait for no worker. The status file leaves them out of its queue. */
const QUIET_REASONS = new Set(["hold stage", "stage unavailable"]);

type CancelledStories = Record<string, { stage: string; hash: string }>;
type ScanResult = ReturnType<typeof evaluateScan>;
type Decision = ScanResult["decisions"][number];

/** The Stories of a reservation that `scan` does not skip for a reason that the reservation checks itself. */
export interface ScanExemptions {
  /** The Thread of a resume: its Story is not skipped to wait for the network resume. */
  readonly resumeThreadId?: string;
  /** The Story of a reservation: the reservation checks the pause of its own model. */
  readonly reservedStory?: string;
}

/** The part of the state that a new manager restores from the previous status file. */
export type StoredStatus = Partial<Pick<ManagerState, "attention" | "providers" | "networkFailures">>;

/**
 * Reads the attention entries and the provider pauses of the previous status file. An absent or invalid file gives no
 * state. The keys of an old supervisor, for example `holds`, `deliveredReportIds` or `nextWakeAt`, have no effect.
 */
export async function loadStoredStatus(paths: ProjectPaths): Promise<StoredStatus> {
  try {
    const stored = JSON.parse(await readFile(await runtimePath(paths, "status.json"), "utf8"));

    const attention: [string, Attention][] = Array.isArray(stored.attention)
      ? stored.attention.filter(
          (entry: unknown) =>
            Array.isArray(entry) && typeof entry[0] === "string" && typeof entry[1]?.text === "string",
        )
      : [];

    return {
      attention: new Map(attention),
      providers: new Map(Object.entries(stored.providers ?? {}) as [string, ProviderPause][]),
      networkFailures: new Map(storedCounts(stored.networkFailures)),
    };
  } catch {
    return {};
  }
}

/** Gives the entries of a stored record of counts. An entry that is not a positive integer is not kept. */
function storedCounts(value: unknown): [string, number][] {
  const entries = typeof value === "object" && value !== null ? Object.entries(value) : [];

  return entries.filter((entry): entry is [string, number] => Number.isSafeInteger(entry[1]) && entry[1] > 0);
}

/** Lists the Stages in board order with the hash and the class of each prompt. The class comes from the rule. */
export async function classifiedStages(manager: Manager) {
  const stages = await listStages(manager.ctx);
  const { stageClasses } = getState(manager).settings;

  return stages.map((stage, index) => ({
    ...stage,
    promptHash: promptHash(stage.prompt),
    promptClass: stageClassOf(stages, index, stageClasses),
  }));
}

/** Gives the reason to skip a Story that the user cancelled, or undefined. */
function cancelledReason(story: Story | undefined, cancelled: CancelledStories): string | undefined {
  if (story && cancelled[story.id]?.stage === story.stage && cancelled[story.id]?.hash === storyHash(story)) {
    return "cancelled by user";
  }

  return undefined;
}

/** Gives the IDs of the Stories whose network Thread the manager can resume, except the Thread of a resume. */
async function networkWaitStories(manager: Manager, stories: readonly Story[], resumeThreadId?: string) {
  const { threads } = await listThreads({ role: "worker" }, manager.ctx);
  const waiting = await networkWaitingThreads(threads, stories);

  return new Set(waiting.filter((t) => t.id !== resumeThreadId).map((t) => t.storyId as string));
}

/** Selects the worker model of a decision from the factory settings. */
function decisionModel(manager: Manager, decision: Decision): WorkerSelection {
  const target = { storyId: decision.story, stage: decision.stage };

  return selectWorkerModel(getState(manager).settings, target, (provider) => isProviderPaused(manager, provider));
}

/** Gives `provider paused` for a start or a retry when no worker model of the Story has a provider that is not paused. */
function pausedReason(manager: Manager, decision: Decision, exempt: ScanExemptions): string | undefined {
  if (!["start", "retry"].includes(decision.action) || decision.story === exempt.reservedStory) {
    return undefined;
  }

  return decisionModel(manager, decision).paused ? PROVIDER_PAUSED_REASON : undefined;
}

/**
 * Evaluates the policy, then skips Stories that the user cancelled, Stories whose network
 * Thread can resume, and Stories whose worker providers are all paused. The exemptions of a reservation keep its
 * Story. A Story whose remote Thread is not synchronized keeps the reason `waiting for host sync`, because that rule
 * comes first.
 */
export async function scan(
  manager: Manager,
  maxActive = managerCapacity(getState(manager)),
  exempt: ScanExemptions = {},
): Promise<ScanResult> {
  const stories = await searchStories({}, manager.ctx);
  const stages = await classifiedStages(manager);
  const state = await readFactoryState(manager.paths.root, manager.ctx);

  const { hostSync } = getState(manager);
  const policy = evaluateScan(state, { stories, stages, maxActive, hostSync: [...hostSync] });
  const cancelled = (state.nativeCancelled ?? {}) as CancelledStories;
  const networkWaits = await networkWaitStories(manager, stories, exempt.resumeThreadId);

  const decisions = policy.decisions.map((decision) => {
    if (decision.reason === HOST_SYNC_REASON) {
      return decision;
    }

    const story = stories.find((s) => s.id === decision.story);
    const reason =
      cancelledReason(story, cancelled) ??
      (networkWaits.has(decision.story) ? NETWORK_WAIT_REASON : undefined) ??
      pausedReason(manager, decision, exempt);

    return reason ? { ...decision, action: "skip" as const, reason } : decision;
  });

  return { ...policy, decisions };
}

/** Adds the `dependsOn`, `blocks` and `waitingFor` lists of its Story to each decision. */
async function withDependencies(manager: Manager, decisions: readonly Decision[]) {
  const stories = await searchStories({}, manager.ctx);
  const stages = await listStages(manager.ctx);

  return decisions.map((decision) => ({ ...decision, ...dependencyLists(stories, stages, decision.story) }));
}

/** Builds one page of the factory status for the status file. */
export async function buildSnapshot(manager: Manager, cursor = 0, pageLimit = 12) {
  const policy = await scan(manager);
  const { threads, issues } = await listThreads({}, manager.ctx);
  const pageEnd = cursor + pageLimit;
  const decisions = await withDependencies(manager, policy.decisions.slice(cursor, pageEnd));

  const state = setState(manager, (current) => ({ revision: current.revision + 1 }));
  const workers = threads.filter((t) => t.role === "worker" && t.runs.at(-1)?.ownerToken === manager.owner.token);

  return {
    version: 1,
    owner: manager.owner,
    phase: state.phase,
    revision: state.revision,
    heartbeatAt: new Date().toISOString(),
    workers: {
      running: workers.filter((t) => t.status === "running").length,
      pending: workers.filter((t) => t.status === "pending").length,
      waiting: policy.decisions.filter((d) => ["start", "retry"].includes(d.action)).length,
      limit: state.limit,
    },
    decisions,
    nextCursor: policy.decisions.length > pageEnd ? pageEnd : null,
    attention: [...issues, ...state.attention.entries()].slice(0, 12),
    hosts: withContactFacts(managerSlots(state), state.hostHealth),
    providers: Object.fromEntries(state.providers),
    networkFailures: Object.fromEntries(state.networkFailures),
    connectivity: connectivityOf(state.settings, state.providers),
    ...(state.settings.checks ? { checks: checkQueueStatus(manager.checks) } : {}),
    threads: threads
      .slice(-12)
      .map((t) => ({ id: t.id, storyId: t.storyId, stage: t.stage, status: t.status, host: t.host, result: t.result })),
  };
}

/** Gives the next pause or retry deadline in the future, or undefined. */
function nextDeadline(state: Readonly<ManagerState>, decisions: readonly Decision[]): number | undefined {
  const deadlines = [
    ...[...state.providers.values()].map((p) => Date.parse(p.retryAt ?? "")),
    ...decisions.map((d) => Date.parse(d.retryAt ?? "")),
  ].filter((t) => Number.isFinite(t) && t > Date.now());

  return deadlines.length ? Math.min(...deadlines) : undefined;
}

/** One queue entry of the status file, with the provider of the selected worker model, with the fallback. */
function queueEntry(manager: Manager, d: Decision) {
  const provider = decisionModel(manager, d).choice?.provider;

  return {
    story: d.story,
    stage: d.stage,
    action: d.action,
    reason: d.reason,
    retryAt: d.retryAt,
    ...(provider ? { provider } : {}),
  };
}

/** Writes status.json and sets a timer for the next pause or retry deadline. */
export async function persistStatus(manager: Manager): Promise<void> {
  clearTimeout(getState(manager).deadlineTimer);

  const policy = await scan(manager);
  const deadline = nextDeadline(getState(manager), policy.decisions);

  if (!getState(manager).stopping && deadline !== undefined) {
    const deadlineTimer = setTimeout(() => notify(manager), Math.max(1, deadline - Date.now()));

    deadlineTimer.unref();
    setState(manager, () => ({ deadlineTimer }));
  }

  // The TUI shows the queued work and its reasons.
  const queue = policy.decisions
    .filter((d) => d.action !== "skip" || !QUIET_REASONS.has(d.reason))
    .slice(0, 50)
    .map((d) => queueEntry(manager, d));
  const status = { ...(await buildSnapshot(manager)), queue };

  await writeFileAtomic(await runtimePath(manager.paths, "status.json"), `${JSON.stringify(status)}\n`, {
    mode: 0o600,
    durable: true,
  });
}
