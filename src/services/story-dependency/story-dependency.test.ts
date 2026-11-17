import { describe, expect, it } from "vitest";
import {
  blocksOf,
  type DependencyStory,
  dependencyCandidates,
  dependencyError,
  dependencyIndex,
  findCycle,
  indexedIsBlocked,
  indexedWaitingFor,
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

  it("dependencyIndex gives each story by its ID", () => {
    const index = dependencyIndex(stories);

    expect([...index.byId.keys()]).toEqual(["ROW-01", "ROW-02", "ROW-03", "ROW-04", "ROW-05"]);
    expect(index.byId.get("ROW-03")?.dependsOn).toEqual(["ROW-01", "ROW-02"]);
  });

  it("the indexed forms give the same results as waitingFor and isBlocked", () => {
    const index = dependencyIndex(stories);

    // A waiting upstream story, a complete upstream story, an unknown upstream ID and an unknown story ID.
    for (const id of ["ROW-03", "ROW-04", "ROW-05", "ROW-77", "ROW-01"]) {
      expect(indexedWaitingFor(index, STAGES, id)).toEqual(waitingFor(stories, STAGES, id));
      expect(indexedIsBlocked(index, STAGES, id)).toBe(isBlocked(stories, STAGES, id));
    }

    expect(indexedWaitingFor(index, STAGES, "ROW-03")).toEqual(["ROW-02"]);
    expect(indexedWaitingFor(index, STAGES, "ROW-05")).toEqual([]);
  });
});

describe("dependencyCandidates", () => {
  const stories = [
    story("ROW-01"),
    story("ROW-02", ["ROW-01"]),
    story("ROW-03", ["ROW-02"]),
    story("ROW-04"),
    story("ROW-05", [], "DONE"),
  ];

  it("does not give the story itself", () => {
    expect(dependencyCandidates(stories, "ROW-04", [])).not.toContain("ROW-04");
  });

  it("does not give the stories that are already in the list", () => {
    expect(dependencyCandidates(stories, "ROW-04", ["ROW-01", "ROW-05"])).toEqual(["ROW-02", "ROW-03"]);
  });

  it("does not give a story that makes a cycle", () => {
    // ROW-03 → ROW-02 → ROW-01, so ROW-01 cannot depend on ROW-02 or ROW-03.
    expect(dependencyCandidates(stories, "ROW-01", [])).toEqual(["ROW-04", "ROW-05"]);
    expect(dependencyCandidates(stories, "ROW-02", ["ROW-01"])).toEqual(["ROW-04", "ROW-05"]);
  });

  it("gives each story that is not in the list for a new story", () => {
    expect(dependencyCandidates(stories, undefined, ["ROW-02"])).toEqual(["ROW-01", "ROW-03", "ROW-04", "ROW-05"]);
  });

  it("gives a story in the last stage", () => {
    expect(dependencyCandidates(stories, "ROW-04", [])).toContain("ROW-05");
  });
});
