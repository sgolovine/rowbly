import { describe, expect, it } from "vitest";
import type { ProjectConfig } from "../config/config.js";
import { fieldUpdates, positionIssues, titleIssues } from "./story-input.js";

const config: ProjectConfig = {
  projectName: "R",
  projectKey: "R",
  customFields: [
    { key: "points", label: "Points", type: "number" },
    { key: "done", label: "Done", type: "boolean" },
  ],
  stages: [{ key: "BACKLOG", label: "Backlog", enabled: true }],
};

describe("fieldUpdates", () => {
  it("coerces each known field and gives an issue for each unknown field or bad value", () => {
    expect(fieldUpdates(config, { points: "3", done: "yes", size: "L" })).toEqual({
      values: { points: 3, done: true },
      issues: [{ path: ["size"], message: 'Unknown custom field "size"' }],
    });
    expect(fieldUpdates(config, { points: "many" }).issues).toEqual([
      { path: ["points"], message: "Points must be a number" },
    ]);
  });
});

describe("titleIssues and positionIssues", () => {
  it("gives an issue only for an empty title or a position that is not a whole number from 1", () => {
    expect(titleIssues("A story")).toEqual([]);
    expect(titleIssues("  ")).toEqual([{ path: ["title"], message: "Title is required" }]);
    expect(positionIssues(undefined)).toEqual([]);
    expect(positionIssues(2)).toEqual([]);
    expect(positionIssues(0)).toEqual([{ path: ["position"], message: "Position must be a whole number from 1" }]);
    expect(positionIssues(1.5)).toHaveLength(1);
  });
});
