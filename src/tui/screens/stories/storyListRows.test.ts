import { describe, expect, it } from "vitest";
import type { Stage } from "../../../services/stage/stage.js";
import type { Story } from "../../../services/story/story.js";
import { rowStage, stageRowId, storyListRows } from "./storyListRows.js";

const stages: Stage[] = [
  { key: "BACKLOG", label: "Backlog", enabled: true, prompt: "", position: 1 },
  { key: "DONE", label: "Done", enabled: true, prompt: "", position: 2 },
];
const story = (n: number, stage: string): Story => ({
  id: `ROW-0${n}`,
  number: n,
  title: `Story ${n}`,
  stage,
  position: n,
  description: "",
  fields: {},
  agentLock: null,
  path: "",
});
const stories = [story(1, "DONE"), story(2, "BACKLOG"), story(3, "GONE")];

describe("storyListRows", () => {
  it("gives only the Stories without collapsed sections", () => {
    expect(storyListRows(stages, stories).map((r) => r.id)).toEqual(["ROW-01", "ROW-02", "ROW-03"]);
  });

  it("puts each Story below the heading of its Stage, in board order, with unknown Stages at the end", () => {
    const rows = storyListRows(stages, stories, new Set());
    expect(rows.map((r) => r.id)).toEqual(["stage:BACKLOG", "ROW-02", "stage:DONE", "ROW-01", "stage:GONE", "ROW-03"]);
    expect(rows[0]).toMatchObject({ kind: "stage", label: "Backlog", count: 1, collapsed: false });
  });

  it("leaves out the Stories of a collapsed Stage but keeps its count", () => {
    const rows = storyListRows(stages, stories, new Set(["BACKLOG"]));
    expect(rows.map((r) => r.id)).toEqual(["stage:BACKLOG", "stage:DONE", "ROW-01", "stage:GONE", "ROW-03"]);
    expect(rows[0]).toMatchObject({ count: 1, collapsed: true });
  });

  it("gives the Stage of a heading or a Story", () => {
    const rows = storyListRows(stages, stories, new Set());
    expect(rowStage(rows[0])).toBe("BACKLOG");
    expect(rowStage(rows[3])).toBe("DONE");
    expect(rowStage(undefined)).toBeUndefined();
    expect(stageRowId("DONE")).toBe("stage:DONE");
  });
});
