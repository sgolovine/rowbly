import { cleanup } from "ink-testing-library";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Stage } from "../../../../services/stage/stage.js";
import { renderTui } from "../../../testing/index.js";
import { StageRow } from "./stage-row.js";

afterEach(cleanup);

const stages = [
  { key: "BACKLOG", label: "Backlog", enabled: true, position: 1 },
  { key: "DONE", label: "Done", enabled: false, position: 2 },
] as Stage[];

describe("StageRow", () => {
  it("shows the badge, the key and the state of the Stage", async () => {
    const tui = await renderTui(
      <StageRow
        stage={stages[1] as Stage}
        stages={stages}
        selected
        idle
        labelWidth={10}
        keyWidth={10}
        onClick={vi.fn()}
        onToggle={vi.fn()}
      />,
    );

    expect(tui.frame()).toMatch(/Done\s+DONE\s+●── Disabled/);
  });

  it("toggles the Stage on a click on the Switch", async () => {
    const onToggle = vi.fn();
    const tui = await renderTui(
      <StageRow
        stage={stages[0] as Stage}
        stages={stages}
        selected={false}
        idle
        labelWidth={10}
        keyWidth={10}
        onClick={vi.fn()}
        onToggle={onToggle}
      />,
    );

    await tui.click("Enabled");

    expect(onToggle).toHaveBeenCalledOnce();
  });
});
