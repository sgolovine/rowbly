import { describe, expect, it } from "vitest";
import { pullMessage, upstreamPull } from "./upstream-pull.js";

const stages = [
  { key: "BACKLOG", label: "Backlog", promptClass: "hold" },
  { key: "OFF", label: "Off", promptClass: "work", enabled: false },
  { key: "WORK", label: "Work", promptClass: "work" },
  { key: "WAIT", label: "Waiting", promptClass: "hold" },
  { key: "DONE", label: "Done", promptClass: "hold" },
];

const story = (id: string, stage: string, dependsOn: string[] = []) => ({ id, stage, dependsOn });

describe("upstreamPull", () => {
  it("moves an upstream Story in the first Stage to the first enabled work Stage", () => {
    const pull = upstreamPull([story("ROW-04", "BACKLOG"), story("ROW-05", "WORK", ["ROW-04"])], stages, {});

    expect(pull?.moves).toEqual(["ROW-04"]);
    expect(pull?.waiting).toEqual(["ROW-05"]);
    expect(pull?.to.key).toBe("WORK");
    expect(pull && pullMessage(pull)).toBe("chore(rowbly): move ROW-04 out of Backlog for ROW-05");
  });

  it("moves the indirect upstream Stories in the same pass", () => {
    const stories = [
      story("ROW-03", "BACKLOG"),
      story("ROW-04", "BACKLOG", ["ROW-03"]),
      story("ROW-05", "WORK", ["ROW-04"]),
    ];

    expect(upstreamPull(stories, stages, {})?.moves).toEqual(["ROW-03", "ROW-04"]);
  });

  it("finds an indirect upstream Story through a Story that does not move", () => {
    const stories = [
      story("ROW-03", "BACKLOG"),
      story("ROW-04", "WAIT", ["ROW-03"]),
      story("ROW-05", "WORK", ["ROW-04"]),
    ];

    expect(upstreamPull(stories, stages, {})?.moves).toEqual(["ROW-03"]);
  });

  it("does not move a parked Story, a Story in a hold Stage or a complete Story", () => {
    const stories = [
      story("ROW-01", "BACKLOG"),
      story("ROW-02", "WAIT"),
      story("ROW-03", "DONE"),
      story("ROW-05", "WORK", ["ROW-01", "ROW-02", "ROW-03"]),
    ];

    expect(upstreamPull(stories, stages, { "ROW-01": { stage: "BACKLOG" } })).toBeUndefined();
  });

  it("does not move for a blocked downstream Story outside a work Stage", () => {
    const stories = [story("ROW-04", "BACKLOG"), story("ROW-05", "BACKLOG", ["ROW-04"])];

    expect(upstreamPull(stories, stages, {})).toBeUndefined();
  });

  it("does not move without an enabled work Stage after the first Stage, and stops at a cycle", () => {
    const stories = [story("ROW-04", "BACKLOG"), story("ROW-05", "WORK", ["ROW-04"])];
    const noWork = stages.filter((stage) => stage.key !== "WORK");

    expect(upstreamPull(stories, noWork, {})).toBeUndefined();
    expect(
      upstreamPull([story("ROW-04", "BACKLOG", ["ROW-05"]), story("ROW-05", "WORK", ["ROW-04"])], stages, {})?.moves,
    ).toEqual(["ROW-04"]);
  });
});
