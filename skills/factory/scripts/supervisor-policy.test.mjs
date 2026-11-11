import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import { describe, it } from "node:test";
import {
  DEFAULT_LIMITS,
  evaluateScan,
  markReported,
  normalizeStatus,
  pendingReports,
  recordLaunchFailure,
  recordStart,
  releaseStory,
} from "./supervisor-policy.mjs";

const story = { id: "ROW-01", stage: "IN_REFINEMENT" };
const stages = [
  { key: "BACKLOG", enabled: true, promptClass: "hold" },
  { key: "IN_REFINEMENT", enabled: true, promptClass: "work" },
  { key: "IN_DEVELOPMENT", enabled: true, promptClass: "work" },
  { key: "IN_REVIEW", enabled: true, promptClass: "work" },
  { key: "DONE", enabled: true, promptClass: "hold" },
];
const refinement = stages[1];
const START = Date.parse("2026-11-10T12:00:00.000Z");
const MINUTE = 60_000;
const running = () => ({
  version: 1, scan: { stages: {} },
  attempts: [{ story: "ROW-01", stage: "IN_REFINEMENT", workerId: "worker-1", status: "running", result: null, reported: false }],
});
const facts = (workers = [], stories = [story], extra = {}) => (
  { stories, stages, harnessWorkers: workers, now: new Date(START), ...extra });
const stopped = (status, result = status) => ({ story: story.id, threadId: "worker-1", status, result });
const action = (plan) => plan.decisions[0].action;
const reason = (plan) => plan.decisions[0].reason;
const restart = (state) => JSON.parse(JSON.stringify(state));

/** Runs one worker to a stop with no Stage move, and gives the state after the scan that confirms the stop. */
function stopWithoutMove(state, id, status = "completed", result = "blocked", at = START) {
  const started = recordStart(state, story.id, story.stage, { threadId: id });
  const worker = { story: story.id, threadId: id, status, result };
  return evaluateScan(started, facts([worker], [story], { now: new Date(at) })).state;
}

for (const status of ["failed", "interrupted"]) {
  describe(`${status} worker`, () => {
    it("records the stop first, then retries on the next scan without a Stage change", () => {
      const first = evaluateScan(running(), facts([stopped(status)]));
      assert.equal(action(first), "skip");
      assert.equal(reason(first), "stop confirmed this scan");
      assert.equal(first.state.attempts.at(-1).stoppedScan, 1);
      const second = evaluateScan(first.state, facts([stopped(status)]));
      assert.equal(action(second), "retry");
      assert.equal(reason(second), "worker failed");
      assert.deepEqual(second.decisions[0].previous, { workerId: "worker-1", status, result: status });
      assert.equal(second.state.attempts.at(-1).stoppedScan, 1);
    });

    it("keeps the next-scan boundary after a restart", () => {
      const first = evaluateScan(restart(running()), facts([stopped(status)]));
      assert.equal(action(first), "skip");
      assert.equal(action(evaluateScan(restart(first.state), facts([stopped(status)]))), "retry");
    });

    for (const stage of ["IN_DEVELOPMENT", "IN_REVIEW"]) {
      it(`retries in ${stage} too`, () => {
        const state = running();
        state.attempts[0].stage = stage;
        const moved = [{ ...story, stage }];
        const first = evaluateScan(state, facts([stopped(status)], moved));
        assert.equal(action(evaluateScan(first.state, facts([], moved))), "retry");
      });
    }

    it("has no attempt limit, and waits longer after each failure in a row", () => {
      let state = running();
      let now = START;
      const waits = [];
      for (let index = 1; index <= 30; index += 1) {
        const worker = { ...stopped(status), threadId: `worker-${index}` };
        state = evaluateScan(state, facts([worker], [story], { now: new Date(now) })).state;
        const stoppedAt = now;
        let plan = evaluateScan(state, facts([], [story], { now: new Date(now) }));
        while (action(plan) !== "retry") {
          assert.equal(reason(plan), "retry delay");
          assert.ok(Date.parse(plan.decisions[0].retryAt) > now);
          now += MINUTE;
          plan = evaluateScan(plan.state, facts([], [story], { now: new Date(now) }));
        }
        waits.push((now - stoppedAt) / MINUTE);
        state = recordStart(plan.state, story.id, story.stage, { threadId: `worker-${index + 1}` });
      }
      assert.deepEqual(waits.slice(0, 8), [0, 2, 4, 8, 16, 32, 60, 60]);
      assert.equal(waits.at(-1), DEFAULT_LIMITS.retryCapMinutes);
      assert.equal(state.attempts.length, 31);
      assert.deepEqual(state.parked, {});
    });
  });
}

const failed = () => ({
  version: 1, scan: { stages: {} },
  attempts: [{ ...running().attempts[0], status: "failed", result: "failed", reported: true }],
});

describe("a worker that stops without a Stage move", () => {
  for (const result of ["blocked", "complete", "ready", "changes required"]) {
    it(`starts the next worker on a later scan after the result ${result}`, () => {
      const first = evaluateScan(running(), facts([stopped("completed", result)]));
      assert.equal(action(first), "skip");
      const next = evaluateScan(restart(first.state), facts());
      assert.equal(action(next), "retry");
      assert.equal(reason(next), "worker stopped without a stage move");
      assert.equal(next.decisions[0].attempt, 2);
      assert.deepEqual(next.decisions[0].previous, { workerId: "worker-1", status: "completed", result });
    });
  }

  it("has no delay, because the worker did not fail", () => {
    let state = stopWithoutMove({ version: 1, scan: { stages: {} }, attempts: [] }, "a");
    state = stopWithoutMove(state, "b");
    assert.equal(action(evaluateScan(state, facts())), "retry");
  });

  it("treats the legacy blocked status as a stop without a move", () => {
    const state = running();
    state.attempts[0].status = "blocked";
    assert.equal(pendingReports(state)[0].event, "stopped");
    assert.equal(action(evaluateScan(state, facts())), "retry");
  });
});

describe("a parked Story", () => {
  const park = () => {
    let state = { version: 1, scan: { stages: {} }, attempts: [] };
    for (let index = 1; index <= DEFAULT_LIMITS.attempts; index += 1) state = stopWithoutMove(state, `worker-${index}`);
    return evaluateScan(state, facts());
  };

  it("gets no worker after the limit of workers that stopped without a move", () => {
    const plan = park();
    assert.equal(action(plan), "skip");
    assert.equal(reason(plan), "parked");
    assert.match(plan.state.parked[story.id].reason, /4 workers stopped and the Story did not move/);
    assert.equal(reason(evaluateScan(restart(plan.state), facts())), "parked");
  });

  it("does not count failed and interrupted workers against the limit", () => {
    let state = { version: 1, scan: { stages: {} }, attempts: [] };
    for (let index = 1; index <= 6; index += 1) state = stopWithoutMove(state, `worker-${index}`, "failed", "failed");
    const plan = evaluateScan(state, facts([], [story], { now: new Date(START + 600 * MINUTE) }));
    assert.equal(action(plan), "retry");
    assert.deepEqual(plan.state.parked, {});
  });

  it("is reported one time", () => {
    const { state } = park();
    const parked = (state) => pendingReports(state).filter((report) => report.event === "parked");
    const [report] = parked(state);
    assert.deepEqual(report, { story: story.id, event: "parked", stage: story.stage, reason: state.parked[story.id].reason });
    assert.deepEqual(parked(restart(markReported(state, report))), []);
  });

  it("gets a worker again after a person changes the Story", () => {
    const { state } = park();
    const edited = { ...story, description: "## Blockers\n\nNone. The key is in the vault." };
    const plan = evaluateScan(state, facts([], [edited]));
    assert.equal(action(plan), "retry");
    assert.equal(plan.decisions[0].attempt, 1);
    assert.deepEqual(plan.state.parked, {});
  });

  it("gets a worker again after a person moves it", () => {
    const { state } = park();
    const plan = evaluateScan(state, facts([], [{ ...story, stage: "IN_DEVELOPMENT" }]));
    assert.equal(action(plan), "start");
    assert.deepEqual(plan.state.parked, {});
  });

  it("gets a worker again after a release", () => {
    const plan = evaluateScan(releaseStory(park().state, story.id), facts());
    assert.equal(action(plan), "start");
    assert.equal(plan.decisions[0].attempt, 1);
    assert.equal(plan.state.attempts.length, DEFAULT_LIMITS.attempts);
  });

  it("is forgotten when its Story no longer exists", () => {
    assert.deepEqual(evaluateScan(park().state, facts([], [])).state.parked, {});
  });

  it("parks a Story that comes back to a Stage after the limit of workers there", () => {
    let state = { version: 1, scan: { stages: {} }, attempts: [] };
    const development = { ...story, stage: "IN_DEVELOPMENT" };
    const review = { ...story, stage: "IN_REVIEW" };
    for (let round = 1; round <= DEFAULT_LIMITS.attempts; round += 1) {
      for (const current of [development, review]) {
        const plan = evaluateScan(state, facts([], [current]));
        assert.equal(action(plan), "start", `round ${round} ${current.stage}`);
        const id = `${current.stage}-${round}`;
        state = recordStart(plan.state, current.id, current.stage, { threadId: id });
        state = evaluateScan(state, facts([{ threadId: id, status: "completed", result: "done" }], [current])).state;
      }
    }
    const plan = evaluateScan(state, facts([], [development]));
    assert.equal(reason(plan), "parked");
    assert.match(plan.state.parked[story.id].reason, /came back after 4 workers/);
  });

  it("gives a new budget to a Story that reached a hold Stage", () => {
    let state = { version: 1, scan: { stages: {} }, attempts: [] };
    for (let index = 1; index <= DEFAULT_LIMITS.attempts - 1; index += 1) state = stopWithoutMove(state, `worker-${index}`);
    state = evaluateScan(state, facts([], [{ ...story, stage: "DONE" }])).state;
    const plan = evaluateScan(state, facts());
    assert.equal(action(plan), "start");
    assert.equal(plan.decisions[0].attempt, 1);
  });
});

describe("assignment guards", () => {
  it("does not assume that a missing harness worker stopped", () => {
    assert.equal(action(evaluateScan(running(), facts())), "skip");
  });

  for (const status of ["running", "starting", "unknown", "a new harness status"]) {
    it(`skips a retry with another supervisor's ${status} worker`, () => {
      assert.equal(action(evaluateScan(failed(), facts([{ story: story.id, threadId: "external", status }]))), "skip");
    });
  }

  it("saves a harness status as a status of the state file", () => {
    const plan = evaluateScan(running(), facts([{ threadId: "worker-1", status: "queued" }]));
    assert.equal(plan.state.attempts[0].status, "preparing");
    const unknown = evaluateScan(running(), facts([{ threadId: "worker-1", status: "a new harness status" }]));
    assert.equal(unknown.state.attempts[0].status, "running");
  });

  it("reconciles a legacy stopped worker that the harness says is active", () => {
    assert.equal(action(evaluateScan(failed(), facts([{ threadId: "worker-1", status: "running" }]))), "skip");
  });

  it("waits for a later scan after a previously stopped worker resumes and stops again", () => {
    const state = failed();
    state.scan.count = 3;
    state.attempts.at(-1).stoppedScan = 1;
    const resumed = evaluateScan(state, facts([{ story: story.id, threadId: "worker-1", status: "running" }]));
    assert.equal(action(resumed), "skip");
    const stoppedAgain = evaluateScan(resumed.state, facts([stopped("failed")]));
    assert.equal(action(stoppedAgain), "skip");
    assert.equal(stoppedAgain.state.attempts.at(-1).stoppedScan, 5);
    assert.equal(action(evaluateScan(stoppedAgain.state, facts())), "retry");
    assert.equal(pendingReports(stoppedAgain.state).length, 1);
  });

  it("ignores an agentLock on a Story record", () => {
    const locked = { ...story, agentLock: { stage: story.stage, agent: "other" } };
    assert.equal(action(evaluateScan(failed(), facts([], [locked]))), "retry");
    const empty = { version: 1, scan: { stages: {} }, attempts: [] };
    assert.equal(action(evaluateScan(empty, facts([], [locked]))), "start");
  });

  for (const stage of [null, { ...refinement, enabled: false }, { ...refinement, promptClass: "hold" }]) {
    it(`skips a retry when the Stage is ${stage?.promptClass ?? "absent"} and enabled=${stage?.enabled}`, () => {
      assert.equal(action(evaluateScan(failed(), { ...facts(), stages: stage ? [stage] : [] })), "skip");
    });
  }

  for (const promptClass of ["missing", "invalid", "unclassified"]) {
    it(`skips only the Stories of a Stage with a ${promptClass} prompt`, () => {
      const plan = evaluateScan(failed(), {
        ...facts([], [story, { id: "ROW-02", stage: "IN_REVIEW" }]),
        stages: [{ ...refinement, promptClass }, stages[3]],
      });
      assert.deepEqual(plan.decisions.map(({ action }) => action), ["skip", "start"]);
      assert.match(plan.decisions[0].reason, /^stage prompt/);
    });
  }

  it("uses the current Stage if it changes before a retry", () => {
    const first = evaluateScan(running(), facts([stopped("failed")]));
    const next = evaluateScan(first.state, facts([], [{ ...story, stage: "IN_DEVELOPMENT" }]));
    assert.equal(action(next), "start");
    assert.equal(next.decisions[0].stage, "IN_DEVELOPMENT");
    const returned = evaluateScan(next.state, facts());
    assert.equal(action(returned), "start");
    assert.equal(returned.state.attempts.at(-1).result, "failed");
  });

  it("starts the next Stage on the scan that confirms the stop, when the Story moved", () => {
    const next = evaluateScan(running(), facts([stopped("completed", "ready")], [{ ...story, stage: "IN_DEVELOPMENT" }]));
    assert.equal(action(next), "start");
    assert.equal(next.decisions[0].attempt, 1);
  });

  it("waits for a worker that still runs after a Stage change", () => {
    const next = evaluateScan(running(), facts([], [{ ...story, stage: "IN_DEVELOPMENT" }]));
    assert.equal(action(next), "skip");
    assert.throws(() => recordStart(next.state, story.id, "IN_DEVELOPMENT", { threadId: "second" }));
  });
});

describe("worker limit", () => {
  const empty = () => ({ version: 1, scan: { stages: {} }, attempts: [] });
  const board = [
    { id: "ROW-01", stage: "IN_REFINEMENT" },
    { id: "ROW-02", stage: "IN_DEVELOPMENT" },
    { id: "ROW-03", stage: "IN_REVIEW" },
    { id: "ROW-04", stage: "IN_REVIEW" },
  ];
  const started = (plan) => plan.decisions.filter(({ action }) => action === "start").map(({ story }) => story);

  it("starts all eligible Stories without a limit", () => {
    assert.equal(started(evaluateScan(empty(), facts([], board))).length, 4);
  });

  it("starts the Stories nearest to the last Stage first, then in board order", () => {
    const plan = evaluateScan(empty(), facts([], board, { maxActive: 2 }));
    assert.deepEqual(started(plan), ["ROW-03", "ROW-04"]);
    assert.deepEqual(plan.decisions.filter(({ reason }) => reason === "worker limit").map(({ story }) => story), ["ROW-01", "ROW-02"]);
  });

  it("counts the workers that run, from this supervisor and from others", () => {
    const state = recordStart(empty(), "ROW-04", "IN_REVIEW", { threadId: "own" });
    const other = { story: "ROW-09", threadId: "other", status: "running" };
    assert.deepEqual(started(evaluateScan(state, facts([other], board, { maxActive: 3 }))), ["ROW-03"]);
    assert.deepEqual(started(evaluateScan(state, facts([other], board, { maxActive: 2 }))), []);
  });
});

describe("a launch that failed", () => {
  const empty = () => ({ version: 1, scan: { stages: {} }, attempts: [] });

  it("waits 2 minutes, then twice as long after each failure in a row, to a maximum of 60 minutes", () => {
    let state = empty();
    const waits = [];
    for (let index = 1; index <= 8; index += 1) {
      state = recordLaunchFailure(state, story.id, "usage limit", new Date(START));
      let minutes = 0;
      while (action(evaluateScan(state, facts([], [story], { now: new Date(START + minutes * MINUTE) }))) !== "start") minutes += 1;
      waits.push(minutes);
    }
    assert.deepEqual(waits, [2, 4, 8, 16, 32, 60, 60, 60]);
    const plan = evaluateScan(state, facts());
    assert.equal(reason(plan), "launch delay");
    assert.equal(plan.decisions[0].retryAt, new Date(START + 60 * MINUTE).toISOString());
  });

  it("has no delay after a worker starts", () => {
    const failed = recordLaunchFailure(empty(), story.id, "usage limit", new Date(START));
    const state = recordStart(failed, story.id, story.stage, { threadId: "worker-1" });
    assert.deepEqual(state.launchFailures, {});
  });

  it("does not delay the other Stories", () => {
    const state = recordLaunchFailure(empty(), story.id, "usage limit", new Date(START));
    const plan = evaluateScan(state, facts([], [story, { id: "ROW-02", stage: "IN_REVIEW" }]));
    assert.deepEqual(plan.decisions.map(({ action }) => action), ["skip", "start"]);
  });
});

describe("stalled workers", () => {
  it("lists a worker that runs longer than the limit", () => {
    const state = running();
    state.attempts[0].startedAt = new Date(START - 95 * MINUTE).toISOString();
    assert.deepEqual(evaluateScan(state, facts()).stalled, [
      { story: story.id, stage: story.stage, workerId: "worker-1", minutes: 95 },
    ]);
    state.attempts[0].startedAt = new Date(START - 10 * MINUTE).toISOString();
    assert.deepEqual(evaluateScan(state, facts()).stalled, []);
  });
});

describe("harness statuses", () => {
  const cases = {
    preparing: ["queued", "Starting"], running: ["running", "waiting", "in progress"], completed: ["completed", "DONE"],
    failed: ["failed", "error"], interrupted: ["cancelled", "rolled_back", "not found"], blocked: ["blocked"],
  };
  for (const [status, names] of Object.entries(cases)) {
    it(`reads ${names.join(", ")} as ${status}`, () => {
      for (const name of names) assert.equal(normalizeStatus(name), status);
    });
  }

  it("does not know other names", () => {
    assert.equal(normalizeStatus("a new harness status"), undefined);
    assert.equal(normalizeStatus(undefined), undefined);
  });
});

describe("version 1 state", () => {
  it("retains the last scan stages and recognizes a departure across a restart", () => {
    const state = failed();
    state.scan.stages = { [story.id]: "IN_DEVELOPMENT" };
    const plan = evaluateScan(restart(state), facts());
    assert.equal(action(plan), "start");
    assert.deepEqual(plan.state.scan.stages, { [story.id]: story.stage });
    assert.equal(plan.state.attempts[0].observedStageDeparture, true);
  });

  it("keeps a preparing worker active after a restart", () => {
    const state = running();
    state.attempts[0].status = "preparing";
    assert.equal(action(evaluateScan(restart(state), facts())), "skip");
  });

  it("retries an old failure that has no stop time", () => {
    const state = failed();
    state.attempts.push({ ...state.attempts[0], workerId: "worker-2" });
    assert.equal(action(evaluateScan(state, facts())), "retry");
  });
});

describe("reports per attempt", () => {
  it("reports each failure and retry once across saved-state restarts", () => {
    let state = evaluateScan(running(), facts([stopped("failed")])).state;
    const [failure] = pendingReports(state);
    assert.equal(failure.result, "failed");
    state = restart(markReported(state, failure));
    assert.deepEqual(pendingReports(state), []);
    state = recordStart(evaluateScan(state, facts()).state, story.id, story.stage, { threadId: "retry-1" });
    const [retry] = pendingReports(state);
    assert.deepEqual(retry, { story: story.id, workerId: "retry-1", event: "started" });
    state = restart(markReported(state, retry));
    assert.deepEqual(pendingReports(state), []);
    state = evaluateScan(state, facts([{ ...stopped("interrupted"), threadId: "retry-1" }])).state;
    assert.deepEqual(pendingReports(state), [
      { story: story.id, workerId: "retry-1", event: "stopped", result: "interrupted" },
    ]);
    assert.equal(state.attempts[0].reported, true);
  });

  it("marks the attempt that still has the report when two attempts have the same worker ID", () => {
    let state = evaluateScan(running(), facts([stopped("failed")])).state;
    state = markReported(state, pendingReports(state)[0]);
    state = recordStart(state, story.id, story.stage, { threadId: "worker-1", startReported: true });
    state.attempts[1].startReported = true;
    state = evaluateScan(state, facts([stopped("failed")])).state;
    const [report] = pendingReports(state);
    assert.equal(report.event, "stopped");
    assert.deepEqual(pendingReports(markReported(state, report)), []);
  });

  it("preserves an unsent result report when it archives an attempt", () => {
    const first = evaluateScan(running(), facts([stopped("failed")]));
    const next = recordStart(first.state, story.id, story.stage, { taskId: "retry-task" });
    assert.equal(pendingReports(next).length, 2);
    const saved = pendingReports(next).reduce(markReported, next);
    assert.deepEqual(pendingReports(restart(saved)), []);
    assert.throws(() => recordStart(saved, story.id, story.stage, {}), /worker ID/);
  });
});

describe("installed factory copies", () => {
  it("keeps each bundled file equal to both installed copies", async () => {
    const root = new URL("../../../", import.meta.url);
    const bundled = new URL("skills/factory/", root);
    const files = (await readdir(bundled, { recursive: true, withFileTypes: true }))
      .filter((entry) => entry.isFile())
      .map((entry) => `${entry.parentPath.slice(bundled.pathname.length)}/${entry.name}`.replace(/^\//, ""));
    assert.ok(files.includes("SKILL.md") && files.includes("scripts/factory.mjs"));
    for (const file of files) {
      const expected = await readFile(new URL(file, bundled), "utf8");
      for (const harness of [".agents", ".claude"]) {
        const installed = await readFile(new URL(`${harness}/skills/factory/${file}`, root), "utf8");
        assert.equal(installed, expected, `${harness}: ${file}`);
      }
    }
  });
});
