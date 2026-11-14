import { cleanup } from "ink-testing-library";
import { afterEach, describe, expect, it, vi } from "vitest";
import { renderTui } from "../../../testing/index.js";
import { AiModelsPage } from "./ai-models-page.js";

afterEach(cleanup);

describe("AiModelsPage", () => {
  it("shows each model in its own card, and gives the role of a Change Button", async () => {
    const onModel = vi.fn();
    const tui = await renderTui(
      <AiModelsPage
        settings={{ version: 1, maxWorkers: 4, supervisorModel: { provider: "acme", modelId: "deep-1" } }}
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

  it("shows no Change Button before Pi loads, and no value before the settings load", async () => {
    const tui = await renderTui(<AiModelsPage settings={undefined} ready={false} idle onModel={vi.fn()} />);

    expect(tui.frame()).not.toContain("Change");
    expect(tui.frame()).toContain("—");
  });
});
