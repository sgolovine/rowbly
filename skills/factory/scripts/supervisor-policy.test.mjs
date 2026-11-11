import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { describe, it } from "node:test";
import { evaluateScan, markReported, pendingReports, recordStart } from "./supervisor-policy.mjs";

const story = { id: "ROW-01", stage: "IN_REFINEMENT" };
const stages = [
  { key: "IN_REFINEMENT", enabled: true, promptClass: "work" },
  { key: "IN_DEVELOPMENT", enabled: true, promptClass: "work" },
  { key: "IN_REVIEW", enabled: true, promptClass: "work" },
];
const running = () => ({
  version: 1, scan: { stages: {} },
  attempts: [{ story: "ROW-01", stage: "IN_REFINEMENT", workerId: "worker-1", status: "running", result: null, reported: false }],
});
const facts = (workers = [], stories = [story]) => ({ stories, stages, harnessWorkers: workers });
const stopped = (status, result = status) => ({ story: story.id, threadId: "worker-1", status, result });
const action = (plan) => plan.decisions[0].action;
const restart = (state) => JSON.parse(JSON.stringify(state));

for (const status of ["failed", "interrupted"]) {
  describe(`${status} refinement`, () => {
    it("records the stop first, then retries on the next scan without a Stage change", () => {
      const first = evaluateScan(running(), facts([stopped(status)]));
      assert.equal(action(first), "skip");
      assert.equal(first.state.attempts.at(-1).stoppedScan, 1);
      const second = evaluateScan(first.state, facts([stopped(status)]));
      assert.equal(action(second), "retry");
      assert.equal(second.state.attempts.at(-1).stoppedScan, 1);
    });

    it("keeps the next-scan boundary after a restart", () => {
      const first = evaluateScan(restart(running()), facts([stopped(status)]));
      assert.equal(action(first), "skip");
      assert.equal(action(evaluateScan(restart(first.state), facts([stopped(status)]))), "retry");
    });

    it("has no attempt limit or additional delay", () => {
      let state = running();
      for (let index = 1; index <= 100; index += 1) {
        const worker = { ...stopped(status), threadId: `worker-${index}` };
        const first = evaluateScan(state, facts([worker]));
        assert.equal(action(first), "skip");
        const next = evaluateScan(first.state, facts([worker]));
        assert.equal(action(next), "retry");
        state = recordStart(next.state, story.id, story.stage, { threadId: `worker-${index + 1}` });
      }
      assert.equal(state.attempts.length, 101);
      assert.ok(state.attempts.slice(0, -1).every((attempt) => attempt.result === status));
      assert.equal(state.attempts[0].workerId, "worker-1");
      assert.equal(state.attempts.at(-1).workerId, "worker-101");
    });
  });
}

const failed = () => ({
  version: 1, scan: { stages: {} },
  attempts: [{ ...running().attempts[0], status: "failed", result: "failed", reported: true }],
});

describe("assignment guards", () => {
  it("keeps blocked refinement distinct from a failure, including after a restart", () => {
    const first = evaluateScan(running(), facts([stopped("completed", "blocked")]));
    const next = evaluateScan(restart(first.state), facts());
    assert.equal(action(next), "skip");
    assert.equal(next.decisions[0].reason, "blocked result");
    const failure = failed();
    failure.attempts.at(-1).result = "blocked";
    assert.equal(action(evaluateScan(failure, facts())), "skip");
  });

  for (const result of ["complete", "ready"]) {
    it(`does not retry a successful ${result} refinement result`, () => {
      const first = evaluateScan(running(), facts([stopped("completed", result)]));
      assert.equal(action(evaluateScan(first.state, facts())), "skip");
    });
  }

  for (const stage of ["IN_DEVELOPMENT", "IN_REVIEW"]) {
    for (const status of ["failed", "interrupted"]) {
      it(`keeps ${status} ${stage} attempts ineligible`, () => {
        const state = failed();
        Object.assign(state.attempts.at(-1), { stage, status, result: status });
        assert.equal(action(evaluateScan(state, facts([], [{ ...story, stage }]))), "skip");
      });
    }
  }

  it("does not assume that a missing harness worker stopped", () => {
    assert.equal(action(evaluateScan(running(), facts())), "skip");
  });

  for (const status of ["running", "starting", "unknown"]) {
    it(`skips a retry with another supervisor's ${status} worker`, () => {
      assert.equal(action(evaluateScan(failed(), facts([{ story: story.id, threadId: "external", status }]))), "skip");
    });
  }

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

  for (const stage of [null, { ...stages[0], enabled: false }, { ...stages[0], promptClass: "hold" }]) {
    it(`skips a retry when the Stage is ${stage?.promptClass ?? "absent"} and enabled=${stage?.enabled}`, () => {
      assert.equal(action(evaluateScan(failed(), { ...facts(), stages: stage ? [stage] : [] })), "skip");
    });
  }

  for (const promptClass of ["missing", "invalid"]) {
    it(`stops for a ${promptClass} prompt and suppresses other assignments`, () => {
      const plan = evaluateScan(failed(), {
        ...facts([], [story, { id: "ROW-02", stage: "IN_REVIEW" }]),
        stages: [{ ...stages[0], promptClass }, stages[2]],
      });
      assert.deepEqual(
        plan.decisions.map(({ action }) => action),
        ["stop", "skip"],
      );
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

  it("waits for a worker that still runs after a Stage change", () => {
    const next = evaluateScan(running(), facts([], [{ ...story, stage: "IN_DEVELOPMENT" }]));
    assert.equal(action(next), "skip");
    assert.throws(() => recordStart(next.state, story.id, "IN_DEVELOPMENT", { threadId: "second" }));
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

  it("treats a blocked status as terminal and does not retry it", () => {
    const state = running();
    state.attempts[0].status = "blocked";
    assert.equal(action(evaluateScan(state, facts())), "skip");
    assert.equal(pendingReports(state)[0].event, "stopped");
  });

  it("keeps a preparing worker active after a restart", () => {
    const state = running();
    state.attempts[0].status = "preparing";
    assert.equal(action(evaluateScan(restart(state), facts())), "skip");
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
  it("keeps the bundled policy, instructions and tests equal to both installed copies", async () => {
    const root = new URL("../../../", import.meta.url);
    for (const file of [
      "SKILL.md",
      "references/supervisor-policy.md",
      "scripts/supervisor-policy.mjs",
      "scripts/supervisor-policy.test.mjs",
      "scripts/factory-state.mjs",
      "scripts/factory-state.test.mjs",
    ]) {
      const bundled = await readFile(new URL(`skills/factory/${file}`, root), "utf8");
      for (const harness of [".agents", ".claude"]) {
        const installed = await readFile(new URL(`${harness}/skills/factory/${file}`, root), "utf8");
        assert.equal(installed, bundled, `${harness}: ${file}`);
      }
    }
  });
});
