import type { Key } from "ink";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Stage } from "../../../../services/stage/stage.js";
import * as stageService from "../../../../services/stage/stage.js";
import { createToastStore } from "../../../hooks/index.js";
import { handleStagesKey, type StagesEnv, stageSaved, stagesHints } from "./stage-actions.js";

vi.mock("../../../../services/stage/stage.js", async (original) => ({
  ...(await original<typeof import("../../../../services/stage/stage.js")>()),
  updateStage: vi.fn(async () => ({})),
}));

afterEach(() => {
  vi.clearAllMocks();
});

const stages = [
  { key: "A", label: "A", enabled: true, position: 1 },
  { key: "B", label: "B", enabled: true, position: 2 },
] as Stage[];

function env(overrides: Partial<StagesEnv> = {}): StagesEnv {
  return {
    ctx: {},
    toast: createToastStore(),
    list: { reload: vi.fn(), refresh: vi.fn(), loading: false } as unknown as StagesEnv["list"],
    stages,
    cursor: 0,
    current: stages[0],
    setMode: vi.fn(),
    setSelectedKey: vi.fn(),
    onChange: vi.fn(),
    ...overrides,
  };
}

const key = (overrides: Partial<Key> = {}) => ({ ...overrides }) as Key;

describe("stageActions", () => {
  it("offers the keys of a selected Stage only", () => {
    expect(stagesHints(false, stages[0])).toEqual([]);
    expect(stagesHints(true, undefined).map((h) => h.key)).toEqual(["↑/↓", "n"]);
    expect(stagesHints(true, stages[0]).find((h) => h.key === "space")?.description).toBe("disable");
  });

  it("creates with n, edits with e, and moves the selection with the arrows", () => {
    const e = env();

    handleStagesKey(e, "n", key());
    handleStagesKey(e, "e", key());
    handleStagesKey(e, "", key({ downArrow: true }));

    expect(e.setMode).toHaveBeenNthCalledWith(1, { kind: "new" });
    expect(e.setMode).toHaveBeenNthCalledWith(2, { kind: "edit", stage: stages[0] });
    expect(e.setSelectedKey).toHaveBeenCalledWith("B");
  });

  it("toggles with space and does not move a Stage out of the board", () => {
    const e = env();

    handleStagesKey(e, " ", key());
    handleStagesKey(e, "", key({ upArrow: true, shift: true }));

    expect(stageService.updateStage).toHaveBeenCalledOnce();
    expect(stageService.updateStage).toHaveBeenCalledWith({ key: "A", enabled: false }, {});
  });

  it("ignores the keys of a selected Stage when there is none", () => {
    const e = env({ current: undefined });

    handleStagesKey(e, " ", key());

    expect(stageService.updateStage).not.toHaveBeenCalled();
  });

  it("selects a saved Stage and reads the Stages again", () => {
    const e = env();

    stageSaved(e, stages[1] as Stage);

    expect(e.setSelectedKey).toHaveBeenCalledWith("B");
    expect(e.setMode).toHaveBeenCalledWith({ kind: "list" });
    expect(e.list.reload).toHaveBeenCalledOnce();
    expect(e.onChange).toHaveBeenCalledOnce();
  });
});
