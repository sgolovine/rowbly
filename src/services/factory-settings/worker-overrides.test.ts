import { describe, expect, it } from "vitest";
import type { FactorySettings } from "./factory-settings.js";
import { hasWorkerOverride, resolveWorkerModel, withWorkerOverride, workerOverride } from "./worker-overrides.js";

const base = { provider: "base", modelId: "default" };
const stage = { provider: "stage", modelId: "refine" };
const story = { provider: "story", modelId: "develop", thinkingLevel: "high" as const };
const settings: FactorySettings = {
  maxWorkers: 4,
  workerModel: base,
  stageWorkerModels: { IN_REFINEMENT: stage, IN_DEVELOPMENT: stage },
  storyWorkerModels: { "ROW-1": { IN_DEVELOPMENT: story } },
};

describe("resolveWorkerModel", () => {
  it("gives the Story override for the Stage", () => {
    expect(resolveWorkerModel(settings, "ROW-1", "IN_DEVELOPMENT")).toEqual(story);
  });
  it("gives the Stage override when the Story override is for a different Stage", () => {
    expect(resolveWorkerModel(settings, "ROW-1", "IN_REFINEMENT")).toEqual(stage);
    expect(resolveWorkerModel(settings, "ROW-2", "IN_DEVELOPMENT")).toEqual(stage);
  });
  it("gives the settings model without an override", () => {
    expect(resolveWorkerModel(settings, "ROW-1", "BACKLOG")).toEqual(base);
    expect(workerOverride(settings, "ROW-1", "BACKLOG")).toBeUndefined();
  });
  it("gives undefined without an override or a settings model", () => {
    expect(resolveWorkerModel({ maxWorkers: 4 }, "ROW-1", "BACKLOG")).toBeUndefined();
  });
});

describe("withWorkerOverride", () => {
  it("sets and removes Stage overrides without a change to Story overrides", () => {
    const set = withWorkerOverride(settings, { stage: "BACKLOG" }, base);
    expect(set.stageWorkerModels).toEqual({ IN_REFINEMENT: stage, IN_DEVELOPMENT: stage, BACKLOG: base });
    expect(set.storyWorkerModels).toBe(settings.storyWorkerModels);
    const cleared = withWorkerOverride(settings, { stage: "IN_REFINEMENT" }, undefined);
    expect(cleared.stageWorkerModels).toEqual({ IN_DEVELOPMENT: stage });
    expect(settings.stageWorkerModels).toEqual({ IN_REFINEMENT: stage, IN_DEVELOPMENT: stage });
  });
  it("removes the key of a Story without overrides and an empty map", () => {
    const cleared = withWorkerOverride(settings, { stage: "IN_DEVELOPMENT", storyId: "ROW-1" }, undefined);
    expect(cleared.storyWorkerModels).toBeUndefined();
    const added = withWorkerOverride(settings, { stage: "IN_REFINEMENT", storyId: "ROW-1" }, base);
    expect(added.storyWorkerModels).toEqual({ "ROW-1": { IN_DEVELOPMENT: story, IN_REFINEMENT: base } });
  });
  it("tells if an override exists", () => {
    expect(hasWorkerOverride(settings, { stage: "IN_REFINEMENT" })).toBe(true);
    expect(hasWorkerOverride(settings, { stage: "IN_REFINEMENT", storyId: "ROW-1" })).toBe(false);
    expect(hasWorkerOverride(settings, { stage: "IN_DEVELOPMENT", storyId: "ROW-1" })).toBe(true);
  });
});
