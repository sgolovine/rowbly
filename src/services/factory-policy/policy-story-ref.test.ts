import { describe, expect, it } from "vitest";
import {
  DEFAULT_LIMITS,
  evaluateScan,
  type PolicyAttempt,
  type PolicyStage,
  type PolicyState,
  type PolicyStory,
  releaseStory,
} from "./factory-policy.js";

const UID_A = "11111111-1111-4111-8111-111111111111";
const UID_B = "22222222-2222-4222-8222-222222222222";
const stages: PolicyStage[] = [
  { key: "BACKLOG", enabled: true, promptClass: "hold" },
  { key: "WORK", enabled: true, promptClass: "work" },
];
const NOW = new Date("2026-11-10T12:00:00.000Z");

/** A stopped attempt of a Story in `WORK`, from an older scan. */
const attempt = (story: string, workerId: string, storyUid?: string): PolicyAttempt => ({
  story,
  ...(storyUid ? { storyUid } : {}),
  stage: "WORK",
  workerId,
  status: "completed",
  result: null,
  reported: true,
  startReported: true,
  stoppedAt: "2026-11-10T11:00:00.000Z",
  stoppedScan: 0,
});
const stateWith = (attempts: PolicyAttempt[]): PolicyState => ({
  version: 1,
  scan: { stages: {}, count: 3 },
  attempts,
});
const full = (story: string, storyUid?: string) =>
  Array.from({ length: DEFAULT_LIMITS.attempts }, (_, index) => attempt(story, `w${index}`, storyUid));
const scan = (state: PolicyState, stories: PolicyStory[]) => evaluateScan(state, { stories, stages, now: NOW });
const decisionOf = (result: ReturnType<typeof scan>, id: string) =>
  result.decisions.find((decision) => decision.story === id);

describe("the Story uid in the factory policy", () => {
  it("gives a decision the uid of its Story, and no storyUid for a Story without a uid", () => {
    const result = scan(stateWith([]), [
      { id: "ROW-01", uid: UID_A, stage: "WORK" },
      { id: "ROW-02", stage: "WORK" },
    ]);

    expect(decisionOf(result, "ROW-01")).toMatchObject({ action: "start", storyUid: UID_A });
    expect("storyUid" in (decisionOf(result, "ROW-02") ?? {})).toBe(false);
  });

  it("counts the attempts of a Story by its uid after the Story gets a new number", () => {
    const result = scan(stateWith(full("ROW-01", UID_A)), [
      { id: "ROW-07", uid: UID_A, stage: "WORK" },
      { id: "ROW-01", uid: UID_B, stage: "WORK" },
    ]);

    expect(decisionOf(result, "ROW-07")).toMatchObject({ action: "skip", reason: "parked" });
    expect(decisionOf(result, "ROW-01")).toMatchObject({ action: "start", attempt: 1 });
  });

  it("counts the attempts by the Story ID without a storyUid, or with a storyUid that no Story has", () => {
    const old = scan(stateWith(full("ROW-01")), [{ id: "ROW-01", uid: UID_A, stage: "WORK" }]);
    const unknown = scan(stateWith(full("ROW-01", UID_B)), [{ id: "ROW-01", uid: UID_A, stage: "WORK" }]);

    expect(decisionOf(old, "ROW-01")).toMatchObject({ action: "skip", reason: "parked" });
    expect(decisionOf(unknown, "ROW-01")).toMatchObject({ action: "skip", reason: "parked" });
  });

  it("resets the budget of the attempts with the uid when the Story reaches a hold Stage", () => {
    const result = scan(stateWith(full("ROW-01", UID_A)), [{ id: "ROW-07", uid: UID_A, stage: "BACKLOG" }]);

    expect(result.state.attempts.every((item) => item.budgetReset)).toBe(true);
  });

  it("releases the attempts of a Story by its uid after the Story gets a new number", () => {
    const stories = [
      { id: "ROW-07", uid: UID_A },
      { id: "ROW-01", uid: UID_B },
    ];
    const released = releaseStory(stateWith(full("ROW-01", UID_A)), { id: "ROW-07", uid: UID_A }, stories);
    const other = releaseStory(stateWith(full("ROW-01", UID_A)), { id: "ROW-01", uid: UID_B }, stories);
    const alone = releaseStory(stateWith(full("ROW-01")), { id: "ROW-01", uid: UID_B });

    expect(released.attempts.every((item) => item.budgetReset)).toBe(true);
    expect(released.attempts.at(-1)?.observedStageDeparture).toBe(true);
    expect(other.attempts.some((item) => item.budgetReset)).toBe(false);
    // Without a list of Stories, an attempt without a storyUid matches by the Story ID.
    expect(alone.attempts.every((item) => item.budgetReset)).toBe(true);
  });
});
