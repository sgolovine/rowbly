import { describe, expect, it } from "vitest";
import { dependencyLists } from "./dependency-facts.js";

const stages = [
  { key: "BACKLOG", label: "Backlog", promptClass: "hold" },
  { key: "WORK", label: "Work", promptClass: "work" },
  { key: "DONE", label: "Done", promptClass: "hold" },
];

const story = (id: string, stage: string, dependsOn: string[] = []) => ({ id, stage, dependsOn });

describe("dependencyLists", () => {
  it("gives the upstream, downstream and waiting IDs of the Spec example", () => {
    const stories = [story("ROW-04", "WORK"), story("ROW-05", "WORK", ["ROW-04"])];

    expect(dependencyLists(stories, stages, "ROW-05")).toEqual({
      dependsOn: ["ROW-04"],
      blocks: [],
      waitingFor: ["ROW-04"],
    });
    expect(dependencyLists(stories, stages, "ROW-04")).toEqual({ dependsOn: [], blocks: ["ROW-05"], waitingFor: [] });
  });
});
