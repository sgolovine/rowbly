import { describe, expect, it } from "vitest";
import * as external from "../../../skills/factory/scripts/supervisor-policy.mjs";
import { evaluateScan, type PolicyState, recordStart } from "./factory-policy.js";

describe("factory policy wrapper", () => {
  it("shares the external policy implementation and keeps unknown fields", () => {
    expect(evaluateScan).toBe(external.evaluateScan);
    const state: PolicyState = { version: 1, scan: { stages: {} }, attempts: [], custom: "keep" };
    const facts = {
      stories: [{ id: "ROW-01", stage: "WORK" }],
      stages: [{ key: "WORK", enabled: true, promptClass: "work" }],
    };
    const planned = evaluateScan(state, facts);
    expect(planned.decisions[0]?.action).toBe("start");
    const started = recordStart(planned.state, "ROW-01", "WORK", { workerId: "a" });
    expect(started.custom).toBe("keep");
    expect(evaluateScan(started, facts).decisions[0]?.action).toBe("skip");
  });
});
