import { describe, expect, it } from "vitest";
import type { FactorySettings } from "./factory-settings.js";
import { hasWorkerOverride, selectWorkerModel, withWorkerOverride, workerOverride } from "./worker-overrides.js";

const base = { provider: "base", modelId: "default" };
const stage = { provider: "stage", modelId: "refine" };
const story = { provider: "story", modelId: "develop", thinkingLevel: "high" as const };
const fallbackA = { provider: "fallback-a", modelId: "a" };
const fallbackB = { provider: "fallback-b", modelId: "b" };
const settings: FactorySettings = {
  maxWorkers: 4,
  workerModel: base,
  stageWorkerModels: { IN_REFINEMENT: stage, IN_DEVELOPMENT: stage },
  storyWorkerModels: { "ROW-1": { IN_DEVELOPMENT: story } },
};

const resolve = (value: FactorySettings, storyId: string, stageKey: string) =>
  selectWorkerModel(value, { storyId, stage: stageKey }, () => false).choice;
const pausedOf =
  (...providers: string[]) =>
  (provider: string) =>
    providers.includes(provider);

describe("selectWorkerModel without a paused provider", () => {
  it("gives the Story override for the Stage", () => {
    expect(resolve(settings, "ROW-1", "IN_DEVELOPMENT")).toEqual(story);
  });
  it("gives the Stage override when the Story override is for a different Stage", () => {
    expect(resolve(settings, "ROW-1", "IN_REFINEMENT")).toEqual(stage);
    expect(resolve(settings, "ROW-2", "IN_DEVELOPMENT")).toEqual(stage);
  });
  it("gives the settings model without an override", () => {
    expect(resolve(settings, "ROW-1", "BACKLOG")).toEqual(base);
    expect(workerOverride(settings, "ROW-1", "BACKLOG")).toBeUndefined();
  });
  it("gives undefined without an override or a settings model", () => {
    expect(resolve({ maxWorkers: 4 }, "ROW-1", "BACKLOG")).toBeUndefined();
  });
  it("gives the requested model after the overrides and before workerModel", () => {
    const model = { provider: "requested-pick", modelId: "m" };
    expect(selectWorkerModel(settings, { storyId: "ROW-1", stage: "BACKLOG", model }, () => false).choice).toEqual(
      model,
    );
    expect(
      selectWorkerModel(settings, { storyId: "ROW-1", stage: "IN_DEVELOPMENT", model }, () => false).choice,
    ).toEqual(story);
  });
  it("keeps the selected model and ignores the fallback list", () => {
    const withFallback = { ...settings, fallbackWorkerModels: [fallbackA] };
    expect(selectWorkerModel(withFallback, { storyId: "ROW-1", stage: "BACKLOG" }, () => false)).toEqual({
      choice: base,
      paused: false,
    });
  });
});

describe("selectWorkerModel with a paused provider", () => {
  const withFallback: FactorySettings = { ...settings, fallbackWorkerModels: [fallbackA, fallbackB] };

  it("gives the first fallback model whose provider is not paused", () => {
    expect(selectWorkerModel(withFallback, { storyId: "ROW-1", stage: "BACKLOG" }, pausedOf("base"))).toEqual({
      choice: fallbackA,
      paused: false,
    });
    expect(
      selectWorkerModel(withFallback, { storyId: "ROW-1", stage: "BACKLOG" }, pausedOf("base", "fallback-a")),
    ).toEqual({ choice: fallbackB, paused: false });
  });
  it("applies the fallback to a Story override, a Stage override and a requested model", () => {
    const model = { provider: "requested-pick", modelId: "m" };
    const isPaused = pausedOf("story", "stage", "requested-pick");
    expect(selectWorkerModel(withFallback, { storyId: "ROW-1", stage: "IN_DEVELOPMENT" }, isPaused).choice).toEqual(
      fallbackA,
    );
    expect(selectWorkerModel(withFallback, { storyId: "ROW-2", stage: "IN_REFINEMENT" }, isPaused).choice).toEqual(
      fallbackA,
    );
    expect(selectWorkerModel(withFallback, { storyId: "ROW-1", stage: "BACKLOG", model }, isPaused).choice).toEqual(
      fallbackA,
    );
  });
  it("gives paused when the selected model and all fallback models have a paused provider", () => {
    const isPaused = pausedOf("base", "fallback-a", "fallback-b");
    expect(selectWorkerModel(withFallback, { storyId: "ROW-1", stage: "BACKLOG" }, isPaused)).toEqual({
      choice: base,
      paused: true,
    });
    expect(selectWorkerModel(settings, { storyId: "ROW-1", stage: "BACKLOG" }, pausedOf("base")).paused).toBe(true);
  });
  it("does not check a pause without a selected model", () => {
    const empty: FactorySettings = { maxWorkers: 4, fallbackWorkerModels: [fallbackA] };
    expect(selectWorkerModel(empty, { storyId: "ROW-1", stage: "BACKLOG" }, () => true)).toEqual({
      choice: undefined,
      paused: false,
    });
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
