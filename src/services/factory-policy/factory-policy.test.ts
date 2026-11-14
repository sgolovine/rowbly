import { describe, expect, it } from "vitest";
import {
  DEFAULT_LIMITS,
  evaluateScan,
  markReported,
  normalizeStatus,
  type PolicyDecision,
  type PolicyStage,
  type PolicyState,
  type PolicyStory,
  type PolicyWorker,
  pendingReports,
  recordLaunchFailure,
  recordStart,
  releaseStory,
  type ScanInput,
} from "./factory-policy.js";

const story: PolicyStory = { id: "ROW-01", stage: "IN_REFINEMENT" };
const stages: PolicyStage[] = [
  { key: "BACKLOG", enabled: true, promptClass: "hold" },
  { key: "IN_REFINEMENT", enabled: true, promptClass: "work" },
  { key: "IN_DEVELOPMENT", enabled: true, promptClass: "work" },
  { key: "IN_REVIEW", enabled: true, promptClass: "work" },
  { key: "DONE", enabled: true, promptClass: "hold" },
];
const refinement = stages[1] as PolicyStage;
const START = Date.parse("2026-11-10T12:00:00.000Z");
const MINUTE = 60_000;
const empty = (): PolicyState => ({ version: 1, scan: { stages: {} }, attempts: [] });
const running = (): PolicyState => ({
  version: 1,
  scan: { stages: {} },
  attempts: [
    { story: "ROW-01", stage: "IN_REFINEMENT", workerId: "worker-1", status: "running", result: null, reported: false },
  ],
});
const facts = (workers: PolicyWorker[] = [], stories = [story], extra: Partial<ScanInput> = {}): ScanInput => ({
  stories,
  stages,
  harnessWorkers: workers,
  now: new Date(START),
  ...extra,
});
const stopped = (status: string, result: unknown = status): PolicyWorker => ({
  story: story.id,
  threadId: "worker-1",
  status,
  result,
});
const first = (plan: { decisions: PolicyDecision[] }) => plan.decisions[0] as PolicyDecision;
const action = (plan: { decisions: PolicyDecision[] }) => first(plan).action;
const reason = (plan: { decisions: PolicyDecision[] }) => first(plan).reason;
const restart = (state: PolicyState): PolicyState => JSON.parse(JSON.stringify(state));
const lastAttempt = (state: PolicyState) => state.attempts.at(-1);

/** Runs one worker to a stop with no Stage move, and gives the state after the scan that confirms the stop. */
function stopWithoutMove(state: PolicyState, id: string, status = "completed", result = "blocked", at = START) {
  const started = recordStart(state, story.id, story.stage, { threadId: id });
  const worker = { story: story.id, threadId: id, status, result };
  return evaluateScan(started, facts([worker], [story], { now: new Date(at) })).state;
}

describe("factory policy", () => {
  it("keeps unknown fields", () => {
    const state: PolicyState = { ...empty(), custom: "keep" };
    const work = {
      stories: [{ id: "ROW-01", stage: "WORK" }],
      stages: [{ key: "WORK", enabled: true, promptClass: "work" }],
    };
    const planned = evaluateScan(state, work);
    expect(action(planned)).toBe("start");
    const started = recordStart(planned.state, "ROW-01", "WORK", { workerId: "a" });
    expect(started.custom).toBe("keep");
    expect(action(evaluateScan(started, work))).toBe("skip");
  });

  it("does not change the earlier state", () => {
    const state = running();
    const copy = restart(state);
    evaluateScan(state, facts([stopped("failed")]));
    expect(state).toEqual(copy);
  });
});

describe.each(["failed", "interrupted"])("%s worker", (status) => {
  it("records the stop first, then retries on the next scan without a Stage change", () => {
    const plan = evaluateScan(running(), facts([stopped(status)]));
    expect(action(plan)).toBe("skip");
    expect(reason(plan)).toBe("stop confirmed this scan");
    expect(lastAttempt(plan.state)?.stoppedScan).toBe(1);
    const second = evaluateScan(plan.state, facts([stopped(status)]));
    expect(action(second)).toBe("retry");
    expect(reason(second)).toBe("worker failed");
    expect(first(second).previous).toEqual({ workerId: "worker-1", status, result: status });
    expect(lastAttempt(second.state)?.stoppedScan).toBe(1);
  });

  it("keeps the next-scan boundary after a restart", () => {
    const plan = evaluateScan(restart(running()), facts([stopped(status)]));
    expect(action(plan)).toBe("skip");
    expect(action(evaluateScan(restart(plan.state), facts([stopped(status)])))).toBe("retry");
  });

  it.each(["IN_DEVELOPMENT", "IN_REVIEW"])("retries in %s too", (stage) => {
    const state = running();
    const moved = [{ ...story, stage }];
    const plan = evaluateScan(
      { ...state, attempts: state.attempts.map((attempt) => ({ ...attempt, stage })) },
      facts([stopped(status)], moved),
    );
    expect(action(evaluateScan(plan.state, facts([], moved)))).toBe("retry");
  });

  it("has no attempt limit, and waits longer after each failure in a row", () => {
    let state = running();
    let now = START;
    const waits: number[] = [];
    for (let index = 1; index <= 30; index += 1) {
      const worker = { ...stopped(status), threadId: `worker-${index}` };
      state = evaluateScan(state, facts([worker], [story], { now: new Date(now) })).state;
      const stoppedAt = now;
      let plan = evaluateScan(state, facts([], [story], { now: new Date(now) }));
      while (action(plan) !== "retry") {
        expect(reason(plan)).toBe("retry delay");
        expect(Date.parse(first(plan).retryAt ?? "")).toBeGreaterThan(now);
        now += MINUTE;
        plan = evaluateScan(plan.state, facts([], [story], { now: new Date(now) }));
      }
      waits.push((now - stoppedAt) / MINUTE);
      state = recordStart(plan.state, story.id, story.stage, { threadId: `worker-${index + 1}` });
    }
    expect(waits.slice(0, 8)).toEqual([0, 2, 4, 8, 16, 32, 60, 60]);
    expect(waits.at(-1)).toBe(DEFAULT_LIMITS.retryCapMinutes);
    expect(state.attempts).toHaveLength(31);
    expect(state.parked).toEqual({});
  });
});

const failed = (): PolicyState => ({
  version: 1,
  scan: { stages: {} },
  attempts: running().attempts.map((attempt) => ({ ...attempt, status: "failed", result: "failed", reported: true })),
});

describe("a worker that stops without a Stage move", () => {
  it.each(["blocked", "complete", "ready", "changes required"])(
    "starts the next worker on a later scan after the result %s",
    (result) => {
      const plan = evaluateScan(running(), facts([stopped("completed", result)]));
      expect(action(plan)).toBe("skip");
      const next = evaluateScan(restart(plan.state), facts());
      expect(action(next)).toBe("retry");
      expect(reason(next)).toBe("worker stopped without a stage move");
      expect(first(next).attempt).toBe(2);
      expect(first(next).previous).toEqual({ workerId: "worker-1", status: "completed", result });
    },
  );

  it("has no delay, because the worker did not fail", () => {
    const state = stopWithoutMove(stopWithoutMove(empty(), "a"), "b");
    expect(action(evaluateScan(state, facts()))).toBe("retry");
  });

  it("treats the legacy blocked status as a stop without a move", () => {
    const state = running();
    const blocked: PolicyState = { ...state, attempts: state.attempts.map((item) => ({ ...item, status: "blocked" })) };
    expect(pendingReports(blocked)[0]?.event).toBe("stopped");
    expect(action(evaluateScan(blocked, facts()))).toBe("retry");
  });
});

describe("a parked Story", () => {
  const park = () => {
    let state = empty();
    for (let index = 1; index <= DEFAULT_LIMITS.attempts; index += 1) state = stopWithoutMove(state, `worker-${index}`);
    return evaluateScan(state, facts());
  };

  it("gets no worker after the limit of workers that stopped without a move", () => {
    const plan = park();
    expect(action(plan)).toBe("skip");
    expect(reason(plan)).toBe("parked");
    expect(plan.state.parked?.[story.id]?.reason).toMatch(/4 workers stopped and the Story did not move/);
    expect(reason(evaluateScan(restart(plan.state), facts()))).toBe("parked");
  });

  it("does not count failed and interrupted workers against the limit", () => {
    let state = empty();
    for (let index = 1; index <= 6; index += 1) state = stopWithoutMove(state, `worker-${index}`, "failed", "failed");
    const plan = evaluateScan(state, facts([], [story], { now: new Date(START + 600 * MINUTE) }));
    expect(action(plan)).toBe("retry");
    expect(plan.state.parked).toEqual({});
  });

  it("is reported one time", () => {
    const { state } = park();
    const parked = (current: PolicyState) => pendingReports(current).filter((report) => report.event === "parked");
    const [report] = parked(state);
    if (!report) throw new Error("Missing report");
    expect(report).toEqual({
      story: story.id,
      event: "parked",
      stage: story.stage,
      reason: state.parked?.[story.id]?.reason,
    });
    expect(parked(restart(markReported(state, report)))).toEqual([]);
  });

  it("gets a worker again after a person changes the Story", () => {
    const { state } = park();
    const edited = { ...story, description: "## Blockers\n\nNone. The key is in the vault." };
    const plan = evaluateScan(state, facts([], [edited]));
    expect(action(plan)).toBe("retry");
    expect(first(plan).attempt).toBe(1);
    expect(plan.state.parked).toEqual({});
  });

  it("gets a worker again after a person moves it", () => {
    const { state } = park();
    const plan = evaluateScan(state, facts([], [{ ...story, stage: "IN_DEVELOPMENT" }]));
    expect(action(plan)).toBe("start");
    expect(plan.state.parked).toEqual({});
  });

  it("gets a worker again after a release", () => {
    const plan = evaluateScan(releaseStory(park().state, story.id), facts());
    expect(action(plan)).toBe("start");
    expect(first(plan).attempt).toBe(1);
    expect(plan.state.attempts).toHaveLength(DEFAULT_LIMITS.attempts);
  });

  it("is forgotten when its Story no longer exists", () => {
    expect(evaluateScan(park().state, facts([], [])).state.parked).toEqual({});
  });

  it("parks a Story that comes back to a Stage after the limit of workers there", () => {
    let state = empty();
    const development = { ...story, stage: "IN_DEVELOPMENT" };
    const review = { ...story, stage: "IN_REVIEW" };
    for (let round = 1; round <= DEFAULT_LIMITS.attempts; round += 1) {
      for (const current of [development, review]) {
        const plan = evaluateScan(state, facts([], [current]));
        expect(action(plan), `round ${round} ${current.stage}`).toBe("start");
        const id = `${current.stage}-${round}`;
        state = recordStart(plan.state, current.id, current.stage, { threadId: id });
        state = evaluateScan(state, facts([{ threadId: id, status: "completed", result: "done" }], [current])).state;
      }
    }
    const plan = evaluateScan(state, facts([], [development]));
    expect(reason(plan)).toBe("parked");
    expect(plan.state.parked?.[story.id]?.reason).toMatch(/came back after 4 workers/);
  });

  it("gives a new budget to a Story that reached a hold Stage", () => {
    let state = empty();
    for (let index = 1; index <= DEFAULT_LIMITS.attempts - 1; index += 1) {
      state = stopWithoutMove(state, `worker-${index}`);
    }
    state = evaluateScan(state, facts([], [{ ...story, stage: "DONE" }])).state;
    const plan = evaluateScan(state, facts());
    expect(action(plan)).toBe("start");
    expect(first(plan).attempt).toBe(1);
  });
});

describe("assignment guards", () => {
  it("does not assume that a missing harness worker stopped", () => {
    expect(action(evaluateScan(running(), facts()))).toBe("skip");
  });

  it.each(["running", "starting", "unknown", "a new harness status"])(
    "skips a retry with another supervisor's %s worker",
    (status) => {
      expect(action(evaluateScan(failed(), facts([{ story: story.id, threadId: "external", status }])))).toBe("skip");
    },
  );

  it("saves a harness status as a status of the state file", () => {
    const plan = evaluateScan(running(), facts([{ threadId: "worker-1", status: "queued" }]));
    expect(plan.state.attempts[0]?.status).toBe("preparing");
    const unknown = evaluateScan(running(), facts([{ threadId: "worker-1", status: "a new harness status" }]));
    expect(unknown.state.attempts[0]?.status).toBe("running");
  });

  it("reconciles a legacy stopped worker that the harness says is active", () => {
    expect(action(evaluateScan(failed(), facts([{ threadId: "worker-1", status: "running" }])))).toBe("skip");
  });

  it("waits for a later scan after a previously stopped worker resumes and stops again", () => {
    const base = failed();
    const state: PolicyState = {
      ...base,
      scan: { ...base.scan, count: 3 },
      attempts: base.attempts.map((attempt) => ({ ...attempt, stoppedScan: 1 })),
    };
    const resumed = evaluateScan(state, facts([{ story: story.id, threadId: "worker-1", status: "running" }]));
    expect(action(resumed)).toBe("skip");
    const stoppedAgain = evaluateScan(resumed.state, facts([stopped("failed")]));
    expect(action(stoppedAgain)).toBe("skip");
    expect(lastAttempt(stoppedAgain.state)?.stoppedScan).toBe(5);
    expect(action(evaluateScan(stoppedAgain.state, facts()))).toBe("retry");
    expect(pendingReports(stoppedAgain.state)).toHaveLength(1);
  });

  it("ignores an agentLock on a Story record", () => {
    const locked = { ...story, agentLock: { stage: story.stage, agent: "other" } };
    expect(action(evaluateScan(failed(), facts([], [locked])))).toBe("retry");
    expect(action(evaluateScan(empty(), facts([], [locked])))).toBe("start");
  });

  it.each([null, { ...refinement, enabled: false }, { ...refinement, promptClass: "hold" }])(
    "skips a retry when the Stage is %o",
    (stage) => {
      expect(action(evaluateScan(failed(), { ...facts(), stages: stage ? [stage] : [] }))).toBe("skip");
    },
  );

  it.each(["missing", "invalid", "unclassified"])(
    "skips only the Stories of a Stage with a %s prompt",
    (promptClass) => {
      const plan = evaluateScan(failed(), {
        ...facts([], [story, { id: "ROW-02", stage: "IN_REVIEW" }]),
        stages: [{ ...refinement, promptClass }, stages[3] as PolicyStage],
      });
      expect(plan.decisions.map((decision) => decision.action)).toEqual(["skip", "start"]);
      expect(reason(plan)).toMatch(/^stage prompt/);
    },
  );

  it("uses the current Stage if it changes before a retry", () => {
    const plan = evaluateScan(running(), facts([stopped("failed")]));
    const next = evaluateScan(plan.state, facts([], [{ ...story, stage: "IN_DEVELOPMENT" }]));
    expect(action(next)).toBe("start");
    expect(first(next).stage).toBe("IN_DEVELOPMENT");
    const returned = evaluateScan(next.state, facts());
    expect(action(returned)).toBe("start");
    expect(lastAttempt(returned.state)?.result).toBe("failed");
  });

  it("starts the next Stage on the scan that confirms the stop, when the Story moved", () => {
    const next = evaluateScan(
      running(),
      facts([stopped("completed", "ready")], [{ ...story, stage: "IN_DEVELOPMENT" }]),
    );
    expect(action(next)).toBe("start");
    expect(first(next).attempt).toBe(1);
  });

  it("waits for a worker that still runs after a Stage change", () => {
    const next = evaluateScan(running(), facts([], [{ ...story, stage: "IN_DEVELOPMENT" }]));
    expect(action(next)).toBe("skip");
    expect(() => recordStart(next.state, story.id, "IN_DEVELOPMENT", { threadId: "second" })).toThrow();
  });
});

describe("worker limit", () => {
  const board = [
    { id: "ROW-01", stage: "IN_REFINEMENT" },
    { id: "ROW-02", stage: "IN_DEVELOPMENT" },
    { id: "ROW-03", stage: "IN_REVIEW" },
    { id: "ROW-04", stage: "IN_REVIEW" },
  ];
  const started = (plan: { decisions: PolicyDecision[] }) =>
    plan.decisions.filter((decision) => decision.action === "start").map((decision) => decision.story);

  it("starts all eligible Stories without a limit", () => {
    expect(started(evaluateScan(empty(), facts([], board)))).toHaveLength(4);
  });

  it("starts the Stories nearest to the last Stage first, then in board order", () => {
    const plan = evaluateScan(empty(), facts([], board, { maxActive: 2 }));
    expect(started(plan)).toEqual(["ROW-03", "ROW-04"]);
    const limited = plan.decisions.filter((decision) => decision.reason === "worker limit");
    expect(limited.map((decision) => decision.story)).toEqual(["ROW-01", "ROW-02"]);
  });

  it("counts the workers that run, from this supervisor and from others", () => {
    const state = recordStart(empty(), "ROW-04", "IN_REVIEW", { threadId: "own" });
    const other = { story: "ROW-09", threadId: "other", status: "running" };
    expect(started(evaluateScan(state, facts([other], board, { maxActive: 3 })))).toEqual(["ROW-03"]);
    expect(started(evaluateScan(state, facts([other], board, { maxActive: 2 })))).toEqual([]);
  });
});

describe("a launch that failed", () => {
  it("waits 2 minutes, then twice as long after each failure in a row, to a maximum of 60 minutes", () => {
    let state = empty();
    const waits: number[] = [];
    for (let index = 1; index <= 8; index += 1) {
      state = recordLaunchFailure(state, story.id, "usage limit", new Date(START));
      let minutes = 0;
      while (action(evaluateScan(state, facts([], [story], { now: new Date(START + minutes * MINUTE) }))) !== "start") {
        minutes += 1;
      }
      waits.push(minutes);
    }
    expect(waits).toEqual([2, 4, 8, 16, 32, 60, 60, 60]);
    const plan = evaluateScan(state, facts());
    expect(reason(plan)).toBe("launch delay");
    expect(first(plan).retryAt).toBe(new Date(START + 60 * MINUTE).toISOString());
  });

  it("has no delay after a worker starts", () => {
    const failure = recordLaunchFailure(empty(), story.id, "usage limit", new Date(START));
    const state = recordStart(failure, story.id, story.stage, { threadId: "worker-1" });
    expect(state.launchFailures).toEqual({});
  });

  it("does not delay the other Stories", () => {
    const state = recordLaunchFailure(empty(), story.id, "usage limit", new Date(START));
    const plan = evaluateScan(state, facts([], [story, { id: "ROW-02", stage: "IN_REVIEW" }]));
    expect(plan.decisions.map((decision) => decision.action)).toEqual(["skip", "start"]);
  });
});

describe("stalled workers", () => {
  it("lists a worker that runs longer than the limit", () => {
    const at = (minutes: number): PolicyState => {
      const state = running();
      const startedAt = new Date(START - minutes * MINUTE).toISOString();
      return { ...state, attempts: state.attempts.map((attempt) => ({ ...attempt, startedAt })) };
    };
    expect(evaluateScan(at(95), facts()).stalled).toEqual([
      { story: story.id, stage: story.stage, workerId: "worker-1", minutes: 95 },
    ]);
    expect(evaluateScan(at(10), facts()).stalled).toEqual([]);
  });
});

describe("harness statuses", () => {
  const cases: [string, string[]][] = [
    ["preparing", ["queued", "Starting"]],
    ["running", ["running", "waiting", "in progress"]],
    ["completed", ["completed", "DONE"]],
    ["failed", ["failed", "error"]],
    ["interrupted", ["cancelled", "rolled_back", "not found"]],
    ["blocked", ["blocked"]],
  ];
  it.each(cases)("reads the names of %s", (status, names) => {
    for (const name of names) expect(normalizeStatus(name)).toBe(status);
  });

  it("does not know other names", () => {
    expect(normalizeStatus("a new harness status")).toBeUndefined();
    expect(normalizeStatus(undefined)).toBeUndefined();
  });
});

describe("version 1 state", () => {
  it("retains the last scan stages and recognizes a departure across a restart", () => {
    const state: PolicyState = { ...failed(), scan: { stages: { [story.id]: "IN_DEVELOPMENT" } } };
    const plan = evaluateScan(restart(state), facts());
    expect(action(plan)).toBe("start");
    expect(plan.state.scan.stages).toEqual({ [story.id]: story.stage });
    expect(plan.state.attempts[0]?.observedStageDeparture).toBe(true);
  });

  it("keeps a preparing worker active after a restart", () => {
    const state = running();
    const preparing: PolicyState = {
      ...state,
      attempts: state.attempts.map((attempt) => ({ ...attempt, status: "preparing" })),
    };
    expect(action(evaluateScan(restart(preparing), facts()))).toBe("skip");
  });

  it("retries an old failure that has no stop time", () => {
    const state = failed();
    const attempts = [
      ...state.attempts,
      { ...(state.attempts[0] as PolicyState["attempts"][0]), workerId: "worker-2" },
    ];
    expect(action(evaluateScan({ ...state, attempts }, facts()))).toBe("retry");
  });
});

describe("reports per attempt", () => {
  it("reports each failure and retry once across saved-state restarts", () => {
    let state = evaluateScan(running(), facts([stopped("failed")])).state;
    const [failure] = pendingReports(state);
    if (!failure) throw new Error("Missing failure report");
    expect(failure.result).toBe("failed");
    state = restart(markReported(state, failure));
    expect(pendingReports(state)).toEqual([]);
    state = recordStart(evaluateScan(state, facts()).state, story.id, story.stage, { threadId: "retry-1" });
    const [retry] = pendingReports(state);
    if (!retry) throw new Error("Missing retry report");
    expect(retry).toEqual({ story: story.id, workerId: "retry-1", event: "started" });
    state = restart(markReported(state, retry));
    expect(pendingReports(state)).toEqual([]);
    state = evaluateScan(state, facts([{ ...stopped("interrupted"), threadId: "retry-1" }])).state;
    expect(pendingReports(state)).toEqual([
      { story: story.id, workerId: "retry-1", event: "stopped", result: "interrupted" },
    ]);
    expect(state.attempts[0]?.reported).toBe(true);
  });

  it("marks the attempt that still has the report when two attempts have the same worker ID", () => {
    let state = evaluateScan(running(), facts([stopped("failed")])).state;
    state = markReported(state, pendingReports(state)[0] as NonNullable<ReturnType<typeof pendingReports>[0]>);
    state = recordStart(state, story.id, story.stage, { threadId: "worker-1", startReported: true });
    state = { ...state, attempts: state.attempts.map((attempt) => ({ ...attempt, startReported: true })) };
    state = evaluateScan(state, facts([stopped("failed")])).state;
    const [report] = pendingReports(state);
    if (!report) throw new Error("Missing report");
    expect(report.event).toBe("stopped");
    expect(pendingReports(markReported(state, report))).toEqual([]);
  });

  it("preserves an unsent result report when it archives an attempt", () => {
    const plan = evaluateScan(running(), facts([stopped("failed")]));
    const next = recordStart(plan.state, story.id, story.stage, { taskId: "retry-task" });
    expect(pendingReports(next)).toHaveLength(2);
    const saved = pendingReports(next).reduce(markReported, next);
    expect(pendingReports(restart(saved))).toEqual([]);
    expect(() => recordStart(saved, story.id, story.stage, {})).toThrow(/worker ID/);
  });
});
