import { cleanup } from "ink-testing-library";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Stage } from "../../../../services/stage/stage.js";
import { renderTui } from "../../../testing/index.js";
import { AiModelsPage } from "./ai-models-page.js";

afterEach(cleanup);

describe("AiModelsPage", () => {
  it("shows each model in its own card, and gives the role of a Change Button", async () => {
    const onModel = vi.fn();
    const tui = await renderTui(
      <AiModelsPage
        settings={{ maxWorkers: 4, supervisorModel: { provider: "acme", modelId: "deep-1" } }}
        ready
        idle
        onModel={onModel}
      />,
    );

    expect(tui.frame()).toMatch(/Supervisor model\s+Change\s+s/);
    expect(tui.frame()).toContain("acme/deep-1");
    expect(tui.frame()).toMatch(/Worker model\s+Change\s+w/);
    expect(tui.frame()).toContain("Pi default");

    await tui.click("Change");

    expect(onModel).toHaveBeenCalledWith("supervisor");
  });

  it("shows one row for each Stage with its override or the worker model, and gives the clicked Stage", async () => {
    const onStage = vi.fn();
    const stages = [
      { key: "BACKLOG", label: "Backlog", enabled: true, position: 1 },
      { key: "DONE", label: "Done", enabled: true, position: 2 },
    ] as Stage[];
    const tui = await renderTui(
      <AiModelsPage
        settings={{
          maxWorkers: 4,
          stageWorkerModels: { DONE: { provider: "acme", modelId: "fast-1", thinkingLevel: "low" } },
        }}
        ready
        idle
        onModel={vi.fn()}
        stages={stages}
        stageCursor={0}
        onStage={onStage}
      />,
    );

    expect(tui.frame()).toContain("Stage worker models");
    expect(tui.frame()).toMatch(/▌ ● Backlog\s+Worker model/);
    expect(tui.frame()).toMatch(/● Done\s+acme\/fast-1 · thinking low/);

    await tui.click("● Done");

    expect(onStage).toHaveBeenCalledWith(1);
  });

  it("shows no Change Button before Pi loads, and no value before the settings load", async () => {
    const tui = await renderTui(<AiModelsPage settings={undefined} ready={false} idle onModel={vi.fn()} />);

    expect(tui.frame()).not.toContain("Change");
    expect(tui.frame()).toContain("—");
  });
});
