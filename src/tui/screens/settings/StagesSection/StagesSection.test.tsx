import { cleanup } from "ink-testing-library";
import { afterEach, describe, expect, it, vi } from "vitest";
import { listStages } from "../../../../services/stage/stage.js";
import { useTestProject } from "../../../../services/testProject/testProject.js";
import { keys, renderTui, settle } from "../../../testing/index.js";
import { StagesSection } from "./StagesSection.js";

afterEach(cleanup);

describe("StagesSection", () => {
  const project = useTestProject();

  async function setup() {
    const onChange = vi.fn();
    const tui = await renderTui(<StagesSection ctx={project.ctx} onChange={onChange} />);
    await settle(50);
    await tui.press();
    return { tui, onChange };
  }

  it("lists the Stages in board order with their status", async () => {
    const { tui } = await setup();
    expect(tui.frame()).toMatch(/▌ ● Backlog\s+BACKLOG\s+━━● Enabled/);
    expect(tui.frame()).toMatch(/● Done\s+DONE\s+━━● Enabled/);
  });

  it("disables the selected Stage with space", async () => {
    const { tui, onChange } = await setup();
    await tui.press(keys.space);
    await settle(50);
    await tui.press();
    expect((await listStages(project.ctx))[0]?.enabled).toBe(false);
    expect(tui.frame()).toMatch(/Backlog\s+BACKLOG\s+●── Disabled/);
    expect(onChange).toHaveBeenCalled();
  });

  it("moves the selected Stage with shift+↓, and the selection stays on it", async () => {
    const { tui } = await setup();
    await tui.press(keys.shiftDown);
    await settle(50);
    await tui.press();
    expect((await listStages(project.ctx)).map((s) => s.key)).toEqual(["DONE", "BACKLOG"]);
    expect(tui.frame()).toContain("▌ ● Backlog");
  });

  it("creates a Stage with n", async () => {
    const { tui } = await setup();
    await tui.press("n");
    expect(tui.frame()).toContain("New Stage");
    await tui.type("Review");
    await tui.press(keys.ctrl("s"));
    await settle(50);
    await tui.press();
    expect((await listStages(project.ctx)).map((s) => s.key)).toEqual(["BACKLOG", "DONE", "REVIEW"]);
    expect(tui.frame()).toContain("▌ ● Review");
  });

  it("edits a Stage on a click on its row, and toggles it on a click on its Switch", async () => {
    const { tui } = await setup();
    await tui.click("━━● Enabled");
    await settle(50);
    await tui.press();
    expect((await listStages(project.ctx))[0]?.enabled).toBe(false);
    expect(tui.frame()).not.toContain("Edit Stage");
    await tui.click("Done");
    expect(tui.frame()).toContain("Edit Stage › Done");
  });

  it("edits the selected Stage with enter", async () => {
    const { tui } = await setup();
    await tui.press(keys.down, keys.enter);
    expect(tui.frame()).toContain("Edit Stage › Done");
  });
});
