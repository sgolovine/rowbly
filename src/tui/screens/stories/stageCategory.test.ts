import { describe, expect, it } from "vitest";
import type { Stage } from "../../../services/stage/stage.js";
import { stageCategory } from "./stageCategory.js";

const stage = (key: string, position: number): Stage => ({ key, label: key, enabled: true, prompt: "", position });
const stages = [stage("BACKLOG", 1), stage("DOING", 2), stage("REVIEW", 3), stage("DONE", 4)];

describe("stageCategory", () => {
  it("makes the first Stage backlog, the last done and the others board", () => {
    expect(stages.map((s) => stageCategory(stages, s.key))).toEqual(["backlog", "board", "board", "done"]);
  });

  it("makes an unknown Stage, and the only Stage, backlog", () => {
    expect(stageCategory(stages, "GONE")).toBe("backlog");
    expect(stageCategory([stage("ONLY", 1)], "ONLY")).toBe("backlog");
  });
});
