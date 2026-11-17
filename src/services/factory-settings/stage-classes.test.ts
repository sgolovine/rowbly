import { beforeEach, describe, expect, it } from "vitest";
import { ValidationError } from "../errors/errors.js";
import { createStage } from "../stage/stage.js";
import { type TestProject, useTestProject } from "../test-project/test-project.js";
import { configureFactory, getFactorySettings, setWorkerOverride, updateFactorySettings } from "./factory-settings.js";
import { stageClassOf, validStageClasses, withStageClass } from "./stage-classes.js";

const board = [
  { key: "IDEAS", prompt: "Ideas." },
  { key: "BUILD", prompt: "Build it." },
  { key: "EMPTY", prompt: "  \n" },
  { key: "SHIPPED", prompt: "Shipped." },
];

async function readFactory(p: TestProject): Promise<Record<string, unknown>> {
  return JSON.parse(await p.read("rowbly.config.json")).factory;
}

describe("stageClassOf", () => {
  it("gives hold to the first and the last Stage, also when their keys are not BACKLOG or DONE", () => {
    expect(board.map((_, index) => stageClassOf(board, index, undefined))).toEqual(["hold", "work", "invalid", "hold"]);
  });

  it("gives the class of factory.stageClasses first, also for an empty prompt and for the first and the last Stage", () => {
    const classes = { IDEAS: "work", BUILD: "hold", EMPTY: "work", SHIPPED: "work" } as const;
    expect(board.map((_, index) => stageClassOf(board, index, classes))).toEqual(["work", "hold", "work", "work"]);
  });
});

describe("validStageClasses", () => {
  it("accepts work and hold for any Stage key, and rejects other values", () => {
    expect(validStageClasses(undefined)).toBe(true);
    expect(validStageClasses({ UNKNOWN: "work", OTHER: "hold" })).toBe(true);
    expect(validStageClasses({ WORK: "invalid" })).toBe(false);
    expect(validStageClasses(["work"])).toBe(false);
  });

  it("removes an empty map", () => {
    expect(withStageClass({ A: "hold" }, "A", undefined)).toEqual({ stageClasses: undefined });
    expect(withStageClass({ A: "hold" }, "B", "work")).toEqual({ stageClasses: { A: "hold", B: "work" } });
  });
});

describe("factory configure --class", () => {
  const p = useTestProject();

  beforeEach(async () => {
    await createStage({ label: "In Review", key: "IN_REVIEW", prompt: "Review it.", position: 2 }, p.ctx);
  });

  it("writes the class of a Stage, then clears it and the empty stageClasses key", async () => {
    await updateFactorySettings({ maxWorkers: 2 }, p.ctx);

    const set = await configureFactory({ stage: "in_review", class: "hold" }, p.ctx);
    expect(set.stageClasses).toEqual({ IN_REVIEW: "hold" });
    expect(await readFactory(p)).toEqual({ maxWorkers: 2, stageClasses: { IN_REVIEW: "hold" } });

    await configureFactory({ stage: "DONE", class: "work" }, p.ctx);
    await configureFactory({ stage: "IN_REVIEW", clearClass: true }, p.ctx);
    expect(await readFactory(p)).toEqual({ maxWorkers: 2, stageClasses: { DONE: "work" } });

    await configureFactory({ stage: "DONE", clearClass: true }, p.ctx);
    expect(await readFactory(p)).toEqual({ maxWorkers: 2 });
  });

  it("keeps stageClasses when the other settings change, as a save of the TUI does", async () => {
    await configureFactory({ stage: "IN_REVIEW", class: "hold" }, p.ctx);
    await setWorkerOverride({ stage: "IN_REVIEW" }, { provider: "faux", modelId: "test" }, p.ctx);
    await updateFactorySettings({ placement: "most-free" }, p.ctx);
    expect((await readFactory(p)).stageClasses).toEqual({ IN_REVIEW: "hold" });
  });

  it.each([
    [{ stage: "IN_REVIEW", class: "invalid" }, "--class"],
    [{ class: "hold" }, "Select the Stage"],
    [{ clearClass: true }, "Select the Stage"],
    [{ stage: "NOPE", class: "hold" }, "Unknown stage"],
    [{ stage: "IN_REVIEW", class: "hold", clearClass: true }, "Do not select a class"],
    [{ stage: "IN_REVIEW", class: "hold", story: "TST-01" }, "only the class"],
    [{ stage: "IN_REVIEW", class: "hold", maxWorkers: 2 }, "only the class"],
  ])("gives a VALIDATION error for %o and changes nothing", async (input, message) => {
    const before = await p.read("rowbly.config.json");
    const error = await configureFactory(input, p.ctx).catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(ValidationError);
    expect((error as Error).message).toContain(message);
    expect(await p.read("rowbly.config.json")).toBe(before);
  });

  it("rejects a stored class other than work or hold, and accepts an unknown Stage key", async () => {
    const config = JSON.parse(await p.read("rowbly.config.json"));
    const write = (stageClasses: unknown) =>
      p.write("rowbly.config.json", JSON.stringify({ ...config, factory: { stageClasses } }, null, 2));

    await write({ GONE: "hold" });
    expect((await getFactorySettings(p.ctx)).stageClasses).toEqual({ GONE: "hold" });

    await write({ IN_REVIEW: "invalid" });
    await expect(getFactorySettings(p.ctx)).rejects.toBeInstanceOf(ValidationError);
  });
});
