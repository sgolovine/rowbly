// The pure assignment policy of the factory supervisor. This module does no I/O.
import {
  DEFAULT_LIMITS,
  FAILURE_STATUSES,
  MINUTE,
  normalizeStatus,
  resetBudget,
  STOPPED_STATUSES,
  storyHash,
  withoutKey,
  workerId,
} from "./policy-records.js";
import type {
  AttemptStatus,
  LaunchFailure,
  PolicyAttempt,
  PolicyDecision,
  PolicyLimits,
  PolicyStage,
  PolicyState,
  PolicyStory,
  PolicyWorker,
  ScanInput,
  ScanResult,
  StalledWorker,
} from "./policy-types.js";

export {
  DEFAULT_LIMITS,
  markReported,
  normalizeStatus,
  pendingReports,
  recordLaunchFailure,
  recordStart,
  releaseStory,
  storyHash,
} from "./policy-records.js";
export type * from "./policy-types.js";

type ScanWorker = PolicyWorker & { status: AttemptStatus };

/** The facts of one scan that each step reads. */
interface ScanFacts {
  stories: PolicyStory[];
  stages: PolicyStage[];
  workers: ScanWorker[];
  time: Date;
  count: number;
  limits: PolicyLimits;
}

interface StoryPlan {
  state: PolicyState;
  decision: PolicyDecision;
}

function makeDecision(
  story: PolicyStory,
  action: PolicyDecision["action"],
  reason: string,
  extra: Partial<PolicyDecision> = {},
): PolicyDecision {
  return { story: story.id, stage: story.stage, action, reason, ...extra };
}

/** Gives the attempt with the status and the result of the harness worker. A resumed worker loses its stop. */
function reconcileWorker(attempt: PolicyAttempt, worker: ScanWorker, facts: ScanFacts): PolicyAttempt {
  const wasStopped = STOPPED_STATUSES.has(attempt.status);
  const updated = {
    ...attempt,
    status: worker.status,
    ...(worker.result !== undefined ? { result: worker.result } : {}),
  };

  if (STOPPED_STATUSES.has(worker.status)) {
    return {
      ...updated,
      result: updated.result ?? (worker.status === "completed" ? null : worker.status),
      stoppedAt: updated.stoppedAt ?? worker.stoppedAt ?? facts.time.toISOString(),
      // Old terminal records already confirmed a stop before this scan.
      stoppedScan: updated.stoppedScan ?? (wasStopped ? 0 : facts.count),
    };
  }

  if (!wasStopped) {
    return updated;
  }

  // A resumed harness worker must stop again before a retry can start.
  const { stoppedScan: _stoppedScan, ...rest } = updated;

  return { ...rest, stoppedAt: null, result: null, reported: false };
}

/** Reconciles one record, also for a Story that is absent or on hold. */
function reconcileAttempt(attempt: PolicyAttempt, priorStages: Record<string, string>, facts: ScanFacts) {
  const id = attempt.story;
  const story = facts.stories.find((candidate) => candidate.id === id);
  const departed =
    !story || story.stage !== attempt.stage || (priorStages[id] !== undefined && priorStages[id] !== story.stage);
  const marked = departed ? { ...attempt, observedStageDeparture: true } : attempt;
  const worker = facts.workers.find((candidate) => workerId(candidate) === workerId(attempt));

  // An absent worker is not proof that it stopped.
  return worker ? reconcileWorker(marked, worker, facts) : marked;
}

/** The number of failures in a row at the end of the attempts, in the same Stage stay. */
function failuresInRow(attempts: PolicyAttempt[], stage: string): number {
  const lastOther = attempts.findLastIndex(
    (item) => !FAILURE_STATUSES.has(item.status) || item.stage !== stage || !!item.observedStageDeparture,
  );

  return attempts.length - 1 - lastOther;
}

/** Plans the next worker after a worker that stopped in the same Stage stay. */
function retryDecision(story: PolicyStory, attempts: PolicyAttempt[], attempt: number, facts: ScanFacts) {
  const last = attempts.at(-1) as PolicyAttempt;
  const previous = { workerId: last.workerId, status: last.status, result: last.result ?? null };

  if (!FAILURE_STATUSES.has(last.status)) {
    return makeDecision(story, "retry", "worker stopped without a stage move", { attempt, previous });
  }

  // The first failure retries on the next scan. Each later failure in a row doubles the delay.
  const failures = failuresInRow(attempts, story.stage);
  const { retryMinutes, retryCapMinutes } = facts.limits;
  const delay = failures < 2 ? 0 : Math.min(retryMinutes * 2 ** (failures - 2), retryCapMinutes) * MINUTE;
  const retryAt = Date.parse(last.stoppedAt ?? "") + delay;

  if (retryAt > facts.time.getTime()) {
    return makeDecision(story, "skip", "retry delay", { retryAt: new Date(retryAt).toISOString() });
  }

  return makeDecision(story, "retry", "worker failed", { attempt, previous });
}

/** Plans a Story in a work Stage from its earlier attempts. It can park the Story. */
function planAttempts(state: PolicyState, story: PolicyStory, facts: ScanFacts): StoryPlan {
  const attempts = state.attempts.filter((attempt) => attempt.story === story.id);
  const last = attempts.at(-1);
  const skipReason = attempts.some((attempt) => !STOPPED_STATUSES.has(attempt.status))
    ? "worker stop unconfirmed"
    : state.parked?.[story.id] && "parked";

  if (skipReason) {
    return { state, decision: makeDecision(story, "skip", skipReason) };
  }

  const counted = attempts.filter((attempt) => attempt.stage === story.stage && !attempt.budgetReset);
  const finished = counted.filter((attempt) => !FAILURE_STATUSES.has(attempt.status));
  const sameStay = !!last && !last.observedStageDeparture;

  // The scan that first confirms a stop only records it. The Story can still show its move on the next scan.
  if (sameStay && last.stoppedScan === facts.count) {
    return { state, decision: makeDecision(story, "skip", "stop confirmed this scan") };
  }

  if (finished.length >= facts.limits.attempts) {
    const reason = sameStay
      ? `${finished.length} workers stopped and the Story did not move`
      : `the Story came back after ${finished.length} workers in this Stage`;
    const record = {
      stage: story.stage,
      reason,
      hash: storyHash(story),
      since: facts.time.toISOString(),
      reported: false,
    };

    const parked = { ...state.parked, [story.id]: record };

    return { state: { ...state, parked }, decision: makeDecision(story, "skip", "parked") };
  }

  const attempt = counted.length + 1;

  if (!sameStay) {
    return { state, decision: makeDecision(story, "start", "new stage stay", { attempt }) };
  }

  return { state, decision: retryDecision(story, attempts, attempt, facts) };
}

/** Gives the reason to skip a Story because of its Stage, or nothing for a work Stage. */
function stageSkipReason(stage: PolicyStage | undefined): string | undefined {
  if (!stage?.enabled) {
    return "stage unavailable";
  }

  if (stage.promptClass === "missing" || stage.promptClass === "invalid") {
    return "stage prompt missing or invalid";
  }

  if (stage.promptClass === "unclassified") {
    return "stage prompt not classified";
  }

  return stage.promptClass === "work" ? undefined : "hold stage";
}

/** Plans one Story. */
function planStory(previous: PolicyState, story: PolicyStory, facts: ScanFacts): StoryPlan {
  const parked = previous.parked?.[story.id];
  // A person released the Story: a Stage move or an edit of the Story gives it a new budget.
  const released = !!parked && (parked.stage !== story.stage || parked.hash !== storyHash(story));
  const state = released
    ? resetBudget({ ...previous, parked: withoutKey(previous.parked ?? {}, story.id) }, story.id)
    : previous;
  const reason = stageSkipReason(facts.stages.find((stage) => stage.key === story.stage));

  if (reason) {
    // A Story that reaches a hold Stage, for example Done, starts from zero if it comes back.
    const next = reason === "hold stage" ? resetBudget(state, story.id) : state;

    return { state: next, decision: makeDecision(story, "skip", reason) };
  }

  // The harness list must include workers from other supervisors in this Project.
  if (facts.workers.some((worker) => worker.story === story.id && !STOPPED_STATUSES.has(worker.status))) {
    return { state, decision: makeDecision(story, "skip", "active or unknown harness worker") };
  }

  return planAttempts(state, story, facts);
}

function isLaunch(decision: PolicyDecision): boolean {
  return decision.action === "start" || decision.action === "retry";
}

/** A launch that failed waits before the next launch. The delay doubles with each failure in a row. */
function delayLaunch(decision: PolicyDecision, failure: LaunchFailure | undefined, facts: ScanFacts): PolicyDecision {
  if (!failure || !isLaunch(decision)) {
    return decision;
  }

  const delay = Math.min(facts.limits.retryMinutes * 2 ** (failure.count - 1), facts.limits.retryCapMinutes) * MINUTE;
  const retryAt = Date.parse(failure.at) + delay;

  if (!(retryAt > facts.time.getTime())) {
    return decision;
  }

  return { ...decision, action: "skip", reason: "launch delay", retryAt: new Date(retryAt).toISOString() };
}

function stageIndex(facts: ScanFacts, decision: PolicyDecision): number {
  return facts.stages.findIndex((stage) => stage.key === decision.stage);
}

/** A limit on workers: the Stories nearest to the last Stage start first, then the order of the board. */
function limitWorkers(decisions: PolicyDecision[], state: PolicyState, facts: ScanFacts, maxActive?: number) {
  if (maxActive === undefined || !Number.isFinite(maxActive)) {
    return decisions;
  }

  const activeAttempts = state.attempts.filter((attempt) => !STOPPED_STATUSES.has(attempt.status)).map(workerId);
  const activeWorkers = facts.workers
    .filter((worker) => !STOPPED_STATUSES.has(worker.status))
    .map((worker) => workerId(worker) ?? `story:${worker.story}`);
  const active = new Set([...activeAttempts, ...activeWorkers]);
  const allowed = decisions
    .filter(isLaunch)
    .toSorted((first, second) => stageIndex(facts, second) - stageIndex(facts, first))
    .slice(0, Math.max(0, maxActive - active.size));

  return decisions.map((decision) =>
    isLaunch(decision) && !allowed.includes(decision)
      ? { ...decision, action: "skip" as const, reason: "worker limit" }
      : decision,
  );
}

function stalledWorkers(state: PolicyState, facts: ScanFacts): StalledWorker[] {
  return state.attempts
    .filter((attempt) => !STOPPED_STATUSES.has(attempt.status) && attempt.startedAt)
    .map((attempt) => ({
      story: attempt.story,
      stage: attempt.stage,
      workerId: attempt.workerId,
      minutes: Math.floor((facts.time.getTime() - Date.parse(attempt.startedAt ?? "")) / MINUTE),
    }))
    .filter((attempt) => attempt.minutes >= facts.limits.stallMinutes);
}

/** Keeps only the entries of the Stories that exist. */
function keepKnown<T>(record: Record<string, T>, stories: PolicyStory[]): Record<string, T> {
  return Object.fromEntries(Object.entries(record).filter(([id]) => stories.some((story) => story.id === id)));
}

/** Forgets the parked records and the launch failures of the Stories that no longer exist. */
function forgetAbsent(state: PolicyState, stories: PolicyStory[]): PolicyState {
  return {
    ...state,
    parked: keepKnown(state.parked ?? {}, stories),
    ...(state.launchFailures ? { launchFailures: keepKnown(state.launchFailures, stories) } : {}),
  };
}

/** Plans one scan. Save the returned state before another scan or worker launch. */
export function evaluateScan(previous: PolicyState, input: ScanInput): ScanResult {
  const cloned = structuredClone(previous);
  const priorStages = cloned.scan?.stages ?? {};
  const facts: ScanFacts = {
    stories: input.stories,
    stages: input.stages,
    workers: (input.harnessWorkers ?? []).map((worker) => ({
      ...worker,
      status: normalizeStatus(worker.status) ?? "running",
    })),
    time: new Date(input.now ?? new Date()),
    count: (cloned.scan?.count ?? 0) + 1,
    limits: { ...DEFAULT_LIMITS, ...input.limits },
  };
  const reconciled: PolicyState = {
    ...cloned,
    scan: { ...cloned.scan, stages: priorStages, count: facts.count },
    attempts: (cloned.attempts ?? []).map((attempt) => reconcileAttempt(attempt, priorStages, facts)),
    parked: cloned.parked ?? {},
  };
  const planned = input.stories.reduce(
    (result, story) => {
      const plan = planStory(result.state, story, facts);

      return { state: plan.state, decisions: [...result.decisions, plan.decision] };
    },
    { state: reconciled, decisions: [] as PolicyDecision[] },
  );
  const delayed = planned.decisions.map((decision) =>
    delayLaunch(decision, planned.state.launchFailures?.[decision.story], facts),
  );
  const decisions = limitWorkers(delayed, planned.state, facts, input.maxActive);
  const pruned = forgetAbsent(planned.state, input.stories);
  const stages = Object.fromEntries(input.stories.map((story) => [story.id, story.stage]));

  return { state: { ...pruned, scan: { ...pruned.scan, stages } }, decisions, stalled: stalledWorkers(pruned, facts) };
}
