import type { Key } from "ink";
import { afterEach, describe, expect, it, vi } from "vitest";
import * as settings from "../../../../services/factory-settings/factory-settings.js";
import type { Stage } from "../../../../services/stage/stage.js";
import { createToastStore } from "../../../hooks/index.js";
import { handleKey, type ModelsTabEnv, openStage, saveStoryModel } from "./models-tab-actions.js";

vi.mock("../../../../services/factory-settings/factory-settings.js", async (original) => ({
  ...(await original<typeof import("../../../../services/factory-settings/factory-settings.js")>()),
  setWorkerOverride: vi.fn(async () => ({})),
}));

afterEach(() => {
  vi.clearAllMocks();
});

const backlog = { key: "BACKLOG", label: "Backlog" } as Stage;
const done = { key: "DONE", label: "Done" } as Stage;

function env(overrides: Partial<ModelsTabEnv> = {}): ModelsTabEnv {
  return {
    ctx: {},
    storyId: "ROW-01",
    toast: createToastStore(),
    stages: [backlog, done],
    cursor: 0,
    ready: true,
    setCursor: vi.fn(),
    setTask: vi.fn(),
    reload: vi.fn(),
    ...overrides,
  };
}

const key = (overrides: Partial<Key> = {}) => ({ ...overrides }) as Key;

describe("modelsTabActions", () => {
  it("moves the selection within the Stages, and opens the picker with enter", () => {
    const e = env({ cursor: 1 });

    handleKey(e, "", key({ downArrow: true }));
    handleKey(e, "", key({ return: true }));

    const update = vi.mocked(e.setCursor).mock.calls[0]?.[0] as (n: number) => number;

    expect(update(1)).toBe(1);
    expect(update(0)).toBe(1);
    expect(e.setTask).toHaveBeenCalledWith(done);
  });

  it("does not open the picker before the models load", () => {
    const e = env({ ready: false });

    openStage(e, 1);

    expect(e.setCursor).toHaveBeenCalledWith(1);
    expect(e.setTask).not.toHaveBeenCalled();
  });

  it("saves and removes the Story override through the service, then closes the picker", async () => {
    const e = env();
    const choice = { provider: "acme", modelId: "deep-1" };

    await saveStoryModel(e, done, choice);
    await saveStoryModel(e, done, null);

    expect(settings.setWorkerOverride).toHaveBeenNthCalledWith(1, { stage: "DONE", storyId: "ROW-01" }, choice, {});
    expect(settings.setWorkerOverride).toHaveBeenNthCalledWith(2, { stage: "DONE", storyId: "ROW-01" }, undefined, {});
    expect(e.toast.list().map((t) => t.message)).toEqual([
      "Saved the Done model of ROW-01: acme/deep-1",
      "Removed the Done model of ROW-01",
    ]);
    expect(e.setTask).toHaveBeenCalledWith(null);
    expect(e.reload).toHaveBeenCalledTimes(2);
  });
});
