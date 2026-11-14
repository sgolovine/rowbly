import { describe, expect, it } from "vitest";
import {
  blocksOf,
  type DependencyStory,
  dependencyError,
  findCycle,
  isBlocked,
  isComplete,
  waitingFor,
} from "./story-dependency.js";

const STAGES = [{ key: "BACKLOG" }, { key: "IN_REVIEW" }, { key: "DONE" }];

function story(id: string, dependsOn: string[] = [], stage = "BACKLOG"): DependencyStory {
  return { id, stage, dependsOn };
}

describe("isComplete", () => {
  it("is true only for the last stage", () => {
    expect(isComplete(STAGES, "DONE")).toBe(true);
    expect(isComplete(STAGES, "IN_REVIEW")).toBe(false);
    expect(isComplete(STAGES, "BACKLOG")).toBe(false);
    expect(isComplete(STAGES, "UNKNOWN")).toBe(false);
    expect(isComplete([], "DONE")).toBe(false);
  });
});

describe("findCycle", () => {
  it("gives nothing when the dependencies have no cycle", () => {
    expect(findCycle([story("ROW-01"), story("ROW-02", ["ROW-01"]), story("ROW-03", ["ROW-01", "ROW-02"])])).toBe(
      undefined,
    );
  });

  it("finds a cycle of two stories", () => {
    expect(findCycle([story("ROW-01", ["ROW-03"]), story("ROW-03", ["ROW-01"])])).toEqual([
      "ROW-01",
      "ROW-03",
      "ROW-01",
    ]);
  });

  it("finds a cycle of three stories", () => {
    const stories = [story("ROW-01", ["ROW-02"]), story("ROW-02", ["ROW-03"]), story("ROW-03", ["ROW-01"])];
    expect(findCycle(stories)).toEqual(["ROW-01", "ROW-02", "ROW-03", "ROW-01"]);
  });

  it("finds a self reference", () => {
    expect(findCycle([story("ROW-01"), story("ROW-02", ["ROW-02"])])).toEqual(["ROW-02", "ROW-02"]);
  });
});

describe("dependencyError", () => {
  const stories = [story("ROW-01", ["ROW-03"]), story("ROW-02"), story("ROW-03")];

  it("gives nothing for a valid list or an empty list", () => {
    expect(dependencyError(stories, "ROW-03", ["ROW-02"])).toBeUndefined();
    expect(dependencyError(stories, "ROW-03", [])).toBeUndefined();
    expect(dependencyError(stories, "ROW-04", ["ROW-01", "ROW-02"])).toBeUndefined();
  });

  it("finds an unknown ID", () => {
    expect(dependencyError(stories, "ROW-03", ["ROW-02", "ROW-99"])).toEqual({
      kind: "unknown",
      ids: ["ROW-99"],
      message: "Unknown Story: ROW-99",
    });
  });

  it("finds an ID of a different project", () => {
    expect(dependencyError(stories, "ROW-03", ["ABC-01"])).toMatchObject({ kind: "otherProject", ids: ["ABC-01"] });
  });

  it("finds a self reference", () => {
    expect(dependencyError(stories, "ROW-03", ["ROW-03"])).toMatchObject({ kind: "self", ids: ["ROW-03"] });
  });

  it("finds a cycle and names it", () => {
    expect(dependencyError(stories, "ROW-03", ["ROW-01"])).toEqual({
      kind: "cycle",
      ids: ["ROW-03", "ROW-01", "ROW-03"],
      message: "The dependencies make a cycle: ROW-03 → ROW-01 → ROW-03",
    });
  });

  it("finds a cycle of three stories", () => {
    const chain = [story("ROW-01", ["ROW-02"]), story("ROW-02", ["ROW-03"]), story("ROW-03")];
    expect(dependencyError(chain, "ROW-03", ["ROW-01"])).toMatchObject({
      kind: "cycle",
      ids: ["ROW-03", "ROW-01", "ROW-02", "ROW-03"],
    });
  });
});

describe("blocksOf, waitingFor and isBlocked", () => {
  const stories = [
    story("ROW-01", [], "DONE"),
    story("ROW-02", [], "IN_REVIEW"),
    story("ROW-03", ["ROW-01", "ROW-02"]),
    story("ROW-04", ["ROW-01"]),
    story("ROW-05", ["ROW-99"]),
  ];

  it("blocksOf gives the downstream stories", () => {
    expect(blocksOf(stories, "ROW-01")).toEqual(["ROW-03", "ROW-04"]);
    expect(blocksOf(stories, "ROW-03")).toEqual([]);
  });

  it("waitingFor gives the upstream stories that are not complete", () => {
    expect(waitingFor(stories, STAGES, "ROW-03")).toEqual(["ROW-02"]);
    expect(waitingFor(stories, STAGES, "ROW-04")).toEqual([]);
    expect(waitingFor(stories, STAGES, "ROW-05")).toEqual([]);
    expect(waitingFor(stories, STAGES, "ROW-77")).toEqual([]);
  });

  it("isBlocked is true while an upstream story is not complete", () => {
    expect(isBlocked(stories, STAGES, "ROW-03")).toBe(true);
    expect(isBlocked(stories, STAGES, "ROW-04")).toBe(false);
    expect(isBlocked(stories, STAGES, "ROW-01")).toBe(false);
  });
});
