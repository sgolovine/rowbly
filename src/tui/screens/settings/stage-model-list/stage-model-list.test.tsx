import { cleanup } from "ink-testing-library";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Stage } from "../../../../services/stage/stage.js";
import { renderTui } from "../../../testing/index.js";
import { StageModelList } from "./stage-model-list.js";

afterEach(cleanup);

const stages = [
  { key: "BACKLOG", label: "Backlog", enabled: true, position: 1 },
  { key: "DONE", label: "Done", enabled: false, position: 2 },
] as Stage[];

const items = [
  { stage: stages[0] as Stage, value: "acme/deep-1 · thinking high", inherited: false },
  { stage: stages[1] as Stage, value: "Worker model", inherited: true },
];

describe("StageModelList", () => {
  it("shows each Stage in order with its model, and the bar on the highlighted row", async () => {
    const tui = await renderTui(<StageModelList items={items} cursor={1} active clickable onPick={vi.fn()} />);

    expect(tui.frame()).toMatch(/● Backlog\s+acme\/deep-1 · thinking high[\s\S]*▌ ● Done\s+Worker model/);
  });

  it("gives the index of a clicked row, and takes no click when it is not clickable", async () => {
    const onPick = vi.fn();
    const tui = await renderTui(<StageModelList items={items} cursor={0} active clickable onPick={onPick} />);

    await tui.click("Done");

    expect(onPick).toHaveBeenCalledWith(1);

    const off = vi.fn();
    const quiet = await renderTui(<StageModelList items={items} cursor={0} active clickable={false} onPick={off} />);

    await quiet.click("Done");

    expect(off).not.toHaveBeenCalled();
  });
});
