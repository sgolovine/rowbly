// The supervisor supplies fresh Project and harness facts. This module does no I/O.
const stoppedStatuses = new Set(["completed", "failed", "interrupted"]);

function workerId(worker) {
  return worker.threadId ?? worker.taskId;
}

/** Plans one later scan. Save the returned state before another scan or worker launch. */
export function evaluateScan(previous, { stories, stages, harnessWorkers }) {
  const state = structuredClone(previous);
  state.scan = (state.scan ?? 0) + 1;
  state.workers ??= {};
  state.history ??= [];

  // Reconcile all records, including Stories that are absent or on hold.
  for (const [id, attempt] of Object.entries(state.workers)) {
    const story = stories.find((story) => story.id === id);
    if (!story || story.stage !== attempt.stage) attempt.observedStageDeparture = true;
    const worker = harnessWorkers.find((worker) => workerId(worker) === workerId(attempt));
    if (!worker) continue; // An absent worker is not proof that it stopped.
    const wasStopped = stoppedStatuses.has(attempt.status);
    attempt.status = worker.status;
    if (worker.result !== undefined) attempt.result = worker.result;
    if (stoppedStatuses.has(worker.status)) {
      attempt.result ??= worker.status === "completed" ? null : worker.status;
      // Old terminal records already confirmed a stop before this scan.
      attempt.stoppedScan ??= wasStopped ? 0 : state.scan;
    } else if (wasStopped) {
      // A resumed harness worker must stop again before a retry can start.
      delete attempt.stoppedScan;
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
    const attempt = state.workers[story.id];
    if (attempt && !stoppedStatuses.has(attempt.status)) return decision("skip", "worker stop unconfirmed");
    if (story.agentLock?.stage === story.stage) return decision("skip", "current stage lock");
    if (!attempt || attempt.observedStageDeparture) return decision("start", "new stage stay");
    if (attempt.result === "blocked") return decision("skip", "blocked result");
    if (attempt.stage !== "IN_REFINEMENT" || !["failed", "interrupted"].includes(attempt.result)) {
      return decision("skip", "earlier attempt");
    }
    if (attempt.stoppedScan === state.scan) return decision("skip", "stop confirmed this scan");
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
  return { state, decisions };
}

/** Records a successful launch. Keep the previous attempt in history, including its report flags. */
export function recordStart(previous, story, stage, worker) {
  if (!workerId(worker)) throw new Error("A worker ID is necessary");
  const state = structuredClone(previous);
  state.workers ??= {};
  state.history ??= [];
  const earlier = state.workers[story];
  if (earlier && !stoppedStatuses.has(earlier.status)) throw new Error("The earlier worker has not stopped");
  if (earlier) state.history.push({ ...earlier, story });
  state.workers[story] = { ...worker, stage, status: "running", result: null, reported: false, startReported: false };
  return state;
}

/** Gives unsent reports. Save the flags after the supervisor reports each event. */
export function pendingReports(state) {
  const attempts = [
    ...(state.history ?? []),
    ...Object.entries(state.workers ?? {}).map(([story, attempt]) => ({ ...attempt, story })),
  ];
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
  const attempt = [...(state.history ?? []), ...Object.values(state.workers ?? {})].find(
    (attempt) => workerId(attempt) === report.workerId,
  );
  if (!attempt) throw new Error("Unknown worker report");
  attempt[report.event === "started" ? "startReported" : "reported"] = true;
  return state;
}
