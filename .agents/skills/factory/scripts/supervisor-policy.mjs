// The supervisor supplies fresh Project and harness facts. This module does no I/O.
const stoppedStatuses = new Set(["completed", "failed", "blocked", "interrupted"]);

function workerId(worker) {
  return worker.workerId ?? worker.threadId ?? worker.taskId;
}

/** Plans one later scan. Save the returned state before another scan or worker launch. */
export function evaluateScan(previous, { stories, stages, harnessWorkers }) {
  const state = structuredClone(previous);
  state.scan ??= { stages: {} };
  state.scan.count = (state.scan.count ?? 0) + 1;
  state.attempts ??= [];

  // Reconcile all records, including Stories that are absent or on hold.
  for (const attempt of state.attempts) {
    const id = attempt.story;
    const story = stories.find((story) => story.id === id);
    if (!story || story.stage !== attempt.stage ||
      (state.scan.stages[id] !== undefined && state.scan.stages[id] !== story.stage)) attempt.observedStageDeparture = true;
    const worker = harnessWorkers.find((worker) => workerId(worker) === workerId(attempt));
    if (!worker) continue; // An absent worker is not proof that it stopped.
    const wasStopped = stoppedStatuses.has(attempt.status);
    attempt.status = worker.status;
    if (worker.result !== undefined) attempt.result = worker.result;
    if (stoppedStatuses.has(worker.status)) {
      attempt.result ??= worker.status === "completed" ? null : worker.status;
      attempt.stoppedAt ??= worker.stoppedAt ?? new Date().toISOString();
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
    const stage = stages.find((stage) => stage.key === story.stage);
    const decision = (action, reason) => ({ story: story.id, stage: story.stage, action, reason });
    if (!stage || !stage.enabled) return decision("skip", "stage unavailable");
    if (stage.promptClass === "missing" || stage.promptClass === "invalid") {
      return decision("stop", "stage prompt missing or invalid");
    }
    if (stage.promptClass !== "work") return decision("skip", "hold stage");
    // The harness list must include workers from other supervisors in this Project.
    if (harnessWorkers.some((worker) => worker.story === story.id && !stoppedStatuses.has(worker.status))) {
      return decision("skip", "active or unknown harness worker");
    }
    const attempts = state.attempts.filter((attempt) => attempt.story === story.id);
    const attempt = attempts.at(-1);
    if (attempts.some((attempt) => !stoppedStatuses.has(attempt.status))) return decision("skip", "worker stop unconfirmed");
    if (story.agentLock?.stage === story.stage) return decision("skip", "current stage lock");
    if (!attempt || attempt.observedStageDeparture) return decision("start", "new stage stay");
    if (attempt.status === "blocked" || attempt.result === "blocked") return decision("skip", "blocked result");
    if (attempt.stage !== "IN_REFINEMENT" || !["failed", "interrupted"].includes(attempt.result)) {
      return decision("skip", "earlier attempt");
    }
    if (attempt.stoppedScan === state.scan.count) return decision("skip", "stop confirmed this scan");
    return decision("retry", "failed refinement attempt");
  });
  // A bad enabled prompt stops the whole factory, as in the start checklist.
  if (decisions.some((decision) => decision.action === "stop")) {
    for (const decision of decisions) {
      if (["start", "retry"].includes(decision.action)) {
        decision.action = "skip";
        decision.reason = "factory stopped";
      }
    }
  }
  state.scan.stages = Object.fromEntries(stories.map((story) => [story.id, story.stage]));
  return { state, decisions };
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
  return state;
}

/** Gives unsent reports. Save the flags after the supervisor reports each event. */
export function pendingReports(state) {
  const attempts = state.attempts ?? [];
  return attempts.flatMap((attempt) => {
    const reports = [];
    const id = workerId(attempt);
    // No start flag in an old record means that its launch was already reported.
    if (attempt.startReported === false) reports.push({ story: attempt.story, workerId: id, event: "started" });
    if (stoppedStatuses.has(attempt.status) && !attempt.reported) {
      reports.push({ story: attempt.story, workerId: id, event: "stopped", result: attempt.result });
    }
    return reports;
  });
}

/** Acknowledges one report without suppressing reports for other attempts. */
export function markReported(previous, report) {
  const state = structuredClone(previous);
  const attempt = (state.attempts ?? []).find(
    (attempt) => workerId(attempt) === report.workerId,
  );
  if (!attempt) throw new Error("Unknown worker report");
  attempt[report.event === "started" ? "startReported" : "reported"] = true;
  return state;
}
