// The supervisor supplies fresh Project and harness facts. This module does no I/O.
import { createHash } from "node:crypto";

const stoppedStatuses = new Set(["completed", "failed", "blocked", "interrupted"]);
const failureStatuses = new Set(["failed", "interrupted"]);
const MINUTE = 60_000;

/**
 * - `attempts`: the workers that can finish for one Story in one Stage before the factory parks the Story.
 * - `retryMinutes`, `retryCapMinutes`: the delay after the second failure in a row, and its maximum. It doubles each time.
 * - `stallMinutes`: the run time after which the supervisor examines a worker.
 */
export const DEFAULT_LIMITS = { attempts: 4, retryMinutes: 2, retryCapMinutes: 60, stallMinutes: 90 };

// The names that harnesses use. An unknown name counts as `running`, because absence of proof is not a stop.
const HARNESS_STATUSES = {
  preparing: ["preparing", "queued", "pending", "starting"],
  running: ["running", "active", "in_progress", "working", "waiting", "idle", "unknown"],
  completed: ["completed", "complete", "done", "finished", "succeeded", "success"],
  failed: ["failed", "error", "errored", "crashed"],
  blocked: ["blocked"],
  interrupted: ["interrupted", "cancelled", "canceled", "stopped", "killed", "rolled_back", "not_found", "missing", "deleted"],
};

/** Changes a harness status to a status of the state file. Gives `undefined` for a name that it does not know. */
export function normalizeStatus(status) {
  const name = String(status ?? "").trim().toLowerCase().replaceAll(/[\s-]+/g, "_");
  return Object.keys(HARNESS_STATUSES).find((key) => HARNESS_STATUSES[key].includes(name));
}

function workerId(worker) {
  return worker.workerId ?? worker.threadId ?? worker.taskId;
}

/** Changes when a person or a worker edits the Story. A Stage move or a new position does not change it. */
export function storyHash(story) {
  const content = JSON.stringify([story.title ?? "", story.description ?? "", story.fields ?? {}]);
  return createHash("sha256").update(content).digest("hex").slice(0, 16);
}

// A new budget: the earlier attempts stay in the records, but they no longer count against the limit.
function resetBudget(state, id) {
  for (const attempt of state.attempts) if (attempt.story === id) attempt.budgetReset = true;
}

/** Plans one scan. Save the returned state before another scan or worker launch. */
export function evaluateScan(previous, { stories, stages, harnessWorkers = [], now = new Date(), maxActive, limits: custom }) {
  const limits = { ...DEFAULT_LIMITS, ...custom };
  const time = new Date(now);
  const state = structuredClone(previous);
  state.scan ??= { stages: {} };
  state.scan.stages ??= {};
  state.scan.count = (state.scan.count ?? 0) + 1;
  state.attempts ??= [];
  state.parked ??= {};
  const workers = harnessWorkers.map((worker) => ({ ...worker, status: normalizeStatus(worker.status) ?? "running" }));

  // Reconcile all records, including Stories that are absent or on hold.
  for (const attempt of state.attempts) {
    const id = attempt.story;
    const story = stories.find((story) => story.id === id);
    if (!story || story.stage !== attempt.stage ||
      (state.scan.stages[id] !== undefined && state.scan.stages[id] !== story.stage)) attempt.observedStageDeparture = true;
    const worker = workers.find((worker) => workerId(worker) === workerId(attempt));
    if (!worker) continue; // An absent worker is not proof that it stopped.
    const wasStopped = stoppedStatuses.has(attempt.status);
    attempt.status = worker.status;
    if (worker.result !== undefined) attempt.result = worker.result;
    if (stoppedStatuses.has(worker.status)) {
      attempt.result ??= worker.status === "completed" ? null : worker.status;
      attempt.stoppedAt ??= worker.stoppedAt ?? time.toISOString();
      // Old terminal records already confirmed a stop before this scan.
      attempt.stoppedScan ??= wasStopped ? 0 : state.scan.count;
    } else if (wasStopped) {
      // A resumed harness worker must stop again before a retry can start.
      delete attempt.stoppedScan;
      attempt.stoppedAt = null;
      attempt.result = null;
      attempt.reported = false;
    }
  }

  const decisions = stories.map((story) => {
    const id = story.id;
    const stage = stages.find((stage) => stage.key === story.stage);
    const decision = (action, reason, extra) => ({ story: id, stage: story.stage, action, reason, ...extra });
    const parked = state.parked[id];
    // A person released the Story: a Stage move or an edit of the Story gives it a new budget.
    if (parked && (parked.stage !== story.stage || parked.hash !== storyHash(story))) {
      delete state.parked[id];
      resetBudget(state, id);
    }
    if (!stage || !stage.enabled) return decision("skip", "stage unavailable");
    if (stage.promptClass === "missing" || stage.promptClass === "invalid") {
      return decision("skip", "stage prompt missing or invalid");
    }
    if (stage.promptClass === "unclassified") return decision("skip", "stage prompt not classified");
    if (stage.promptClass !== "work") {
      // A Story that reaches a hold Stage, for example Done, starts from zero if it comes back.
      resetBudget(state, id);
      return decision("skip", "hold stage");
    }
    // The harness list must include workers from other supervisors in this Project.
    if (workers.some((worker) => worker.story === id && !stoppedStatuses.has(worker.status))) {
      return decision("skip", "active or unknown harness worker");
    }
    const attempts = state.attempts.filter((attempt) => attempt.story === id);
    const last = attempts.at(-1);
    if (attempts.some((attempt) => !stoppedStatuses.has(attempt.status))) return decision("skip", "worker stop unconfirmed");
    if (state.parked[id]) return decision("skip", "parked");

    const counted = attempts.filter((attempt) => attempt.stage === story.stage && !attempt.budgetReset);
    const finished = counted.filter((attempt) => !failureStatuses.has(attempt.status));
    const sameStay = last && !last.observedStageDeparture;
    // The scan that first confirms a stop only records it. The Story can still show its move on the next scan.
    if (sameStay && last.stoppedScan === state.scan.count) return decision("skip", "stop confirmed this scan");
    if (finished.length >= limits.attempts) {
      const reason = sameStay
        ? `${finished.length} workers stopped and the Story did not move`
        : `the Story came back after ${finished.length} workers in this Stage`;
      state.parked[id] = { stage: story.stage, reason, hash: storyHash(story), since: time.toISOString(), reported: false };
      return decision("skip", "parked");
    }
    const attempt = counted.length + 1;
    if (!sameStay) return decision("start", "new stage stay", { attempt });
    const earlier = { workerId: workerId(last), status: last.status, result: last.result ?? null };
    if (!failureStatuses.has(last.status)) return decision("retry", "worker stopped without a stage move", { attempt, previous: earlier });
    // The first failure retries on the next scan. Each later failure in a row doubles the delay.
    let failures = 0;
    for (let index = attempts.length - 1; index >= 0; index -= 1) {
      const item = attempts[index];
      if (!failureStatuses.has(item.status) || item.stage !== story.stage || item.observedStageDeparture) break;
      failures += 1;
    }
    const delay = failures < 2 ? 0 : Math.min(limits.retryMinutes * 2 ** (failures - 2), limits.retryCapMinutes) * MINUTE;
    const retryAt = Date.parse(last.stoppedAt) + delay;
    if (retryAt > time.getTime()) return decision("skip", "retry delay", { retryAt: new Date(retryAt).toISOString() });
    return decision("retry", "worker failed", { attempt, previous: earlier });
  });

  // A launch that failed waits before the next launch. The delay doubles with each failure in a row.
  for (const decision of decisions) {
    const failure = state.launchFailures?.[decision.story];
    if (!failure || !["start", "retry"].includes(decision.action)) continue;
    const delay = Math.min(limits.retryMinutes * 2 ** (failure.count - 1), limits.retryCapMinutes) * MINUTE;
    const retryAt = Date.parse(failure.at) + delay;
    if (!(retryAt > time.getTime())) continue;
    Object.assign(decision, { action: "skip", reason: "launch delay", retryAt: new Date(retryAt).toISOString() });
  }

  // A limit on workers: the Stories nearest to the last Stage start first, then the order of the board.
  const starts = decisions.filter((decision) => ["start", "retry"].includes(decision.action));
  if (Number.isFinite(maxActive)) {
    const active = new Set(state.attempts.filter((attempt) => !stoppedStatuses.has(attempt.status)).map(workerId));
    for (const worker of workers) if (!stoppedStatuses.has(worker.status)) active.add(workerId(worker) ?? `story:${worker.story}`);
    const order = (decision) => stages.findIndex((stage) => stage.key === decision.stage);
    const allowed = [...starts].sort((a, b) => order(b) - order(a)).slice(0, Math.max(0, maxActive - active.size));
    for (const decision of starts) {
      if (allowed.includes(decision)) continue;
      decision.action = "skip";
      decision.reason = "worker limit";
    }
  }

  for (const record of [state.parked, state.launchFailures ?? {}]) {
    for (const id of Object.keys(record)) if (!stories.some((story) => story.id === id)) delete record[id];
  }
  const stalled = state.attempts
    .filter((attempt) => !stoppedStatuses.has(attempt.status) && attempt.startedAt)
    .map((attempt) => ({ story: attempt.story, stage: attempt.stage, workerId: workerId(attempt),
      minutes: Math.floor((time.getTime() - Date.parse(attempt.startedAt)) / MINUTE) }))
    .filter((attempt) => attempt.minutes >= limits.stallMinutes);
  state.scan.stages = Object.fromEntries(stories.map((story) => [story.id, story.stage]));
  return { state, decisions, stalled };
}

/** Records a successful launch. Keep each earlier attempt and its report flags. */
export function recordStart(previous, story, stage, worker) {
  if (!workerId(worker)) throw new Error("A worker ID is necessary");
  const state = structuredClone(previous);
  state.attempts ??= [];
  if (state.attempts.some((attempt) => attempt.story === story && !stoppedStatuses.has(attempt.status))) {
    throw new Error("The earlier worker has not stopped");
  }
  state.attempts.push({ ...worker, story, stage, workerId: workerId(worker),
    workerType: worker.workerType ?? (worker.taskId ? "subagent" : "thread"),
    startedAt: worker.startedAt ?? new Date().toISOString(), stoppedAt: null,
    status: "running", result: null, reported: false, startReported: false });
  if (state.launchFailures) delete state.launchFailures[story];
  return state;
}

/** Records a launch that gave no worker. The next launch of the Story waits: 2, 4, 8 … 60 minutes. */
export function recordLaunchFailure(previous, story, error, now = new Date()) {
  const state = structuredClone(previous);
  const count = (state.launchFailures?.[story]?.count ?? 0) + 1;
  state.launchFailures = { ...state.launchFailures, [story]: { count, at: new Date(now).toISOString(), error } };
  return state;
}

/** Makes a Story eligible again after a request from the user. All other assignment checks still apply. */
export function releaseStory(previous, story) {
  const state = structuredClone(previous);
  state.attempts ??= [];
  if (state.parked) delete state.parked[story];
  if (state.nativeCancelled) delete state.nativeCancelled[story];
  resetBudget(state, story);
  const last = state.attempts.findLast((attempt) => attempt.story === story);
  if (last && stoppedStatuses.has(last.status)) last.observedStageDeparture = true;
  return state;
}

/** Gives unsent reports. Save the flags after the supervisor reports each event. */
export function pendingReports(state) {
  const attempts = state.attempts ?? [];
  const reports = attempts.flatMap((attempt) => {
    const reports = [];
    const id = workerId(attempt);
    // No start flag in an old record means that its launch was already reported.
    if (attempt.startReported === false) reports.push({ story: attempt.story, workerId: id, event: "started" });
    if (stoppedStatuses.has(attempt.status) && !attempt.reported) {
      reports.push({ story: attempt.story, workerId: id, event: "stopped", result: attempt.result });
    }
    return reports;
  });
  for (const [story, parked] of Object.entries(state.parked ?? {})) {
    if (!parked.reported) reports.push({ story, event: "parked", stage: parked.stage, reason: parked.reason });
  }
  return reports;
}

/** Acknowledges one report without suppressing reports for other attempts. */
export function markReported(previous, report) {
  const state = structuredClone(previous);
  if (report.event === "parked") {
    if (!state.parked?.[report.story]) throw new Error("Unknown parked report");
    state.parked[report.story].reported = true;
    return state;
  }
  // A harness can give the same ID to two workers. Mark the attempt that still has this report.
  const flag = report.event === "started" ? "startReported" : "reported";
  const matches = (state.attempts ?? []).filter((attempt) => workerId(attempt) === report.workerId);
  const attempt = matches.find((attempt) => !attempt[flag] && (flag === "startReported" || stoppedStatuses.has(attempt.status))) ?? matches[0];
  if (!attempt) throw new Error("Unknown worker report");
  attempt[flag] = true;
  return state;
}
