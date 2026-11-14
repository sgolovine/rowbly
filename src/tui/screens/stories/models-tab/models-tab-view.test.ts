import { describe, expect, it } from "vitest";
import type { Stage } from "../../../../services/stage/stage.js";
import { modelsTabHints, storyModelItems } from "./models-tab-view.js";

const stages = [
  { key: "BACKLOG", label: "Backlog" },
  { key: "REVIEW", label: "Review" },
  { key: "DONE", label: "Done" },
] as Stage[];

describe("modelsTabView", () => {
  it("gives the Story override, else the Stage model, else the worker model of each Stage", () => {
    const settings = {
      maxWorkers: 4,
      workerModel: { provider: "acme", modelId: "deep-1" },
      stageWorkerModels: { DONE: { provider: "openai", modelId: "gpt-sol" }, REVIEW: { provider: "x", modelId: "y" } },
      storyWorkerModels: {
        "ROW-01": { REVIEW: { provider: "acme", modelId: "fast-1", thinkingLevel: "low" as const } },
      },
    };

    expect(storyModelItems(settings, stages, "ROW-01").map(({ value, inherited }) => [value, inherited])).toEqual([
      ["Worker model: acme/deep-1", true],
      ["acme/fast-1 · thinking low", false],
      ["Stage model: openai/gpt-sol", true],
    ]);
    expect(storyModelItems(undefined, stages, "ROW-01")[0]?.value).toBe("Worker model: Pi default");
  });

  it("gives the keys that work now", () => {
    expect(modelsTabHints({ stages: false, ready: true })).toEqual([]);
    expect(modelsTabHints({ stages: true, ready: false }).map((h) => h.key)).toEqual(["↑/↓"]);
    expect(modelsTabHints({ stages: true, ready: true }).map((h) => h.key)).toEqual(["↑/↓", "enter"]);
  });
});
