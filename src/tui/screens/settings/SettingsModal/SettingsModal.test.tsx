import { cleanup } from "ink-testing-library";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useTestProject } from "../../../../services/testProject/testProject.js";
import { keys, renderTui, settle } from "../../../testing/index.js";
import { SettingsModal } from "./SettingsModal.js";

afterEach(cleanup);

describe("SettingsModal", () => {
  const project = useTestProject();

  it("shows the title, the sections and the keys of the section list", async () => {
    const tui = await renderTui(
      <SettingsModal ctx={project.ctx} projectName="Rowbly" onChange={() => {}} onClose={() => {}} />,
    );
    await settle(50);
    const frame = tui.frame();
    expect(frame).toContain("Rowbly › Settings");
    for (const label of ["Project", "General", "Stages", "Custom Fields", "Skills", "Maintenance", "Doctor"]) {
      expect(frame).toContain(label);
    }
    expect(frame).toContain("enter open section");
  });

  it("shows the keys of the section in focus, and closes with esc from the list", async () => {
    const onClose = vi.fn();
    const tui = await renderTui(<SettingsModal ctx={project.ctx} onChange={() => {}} onClose={onClose} />);
    await settle(50);
    await tui.press(keys.down, keys.enter);
    await settle(50);
    await tui.press();
    expect(tui.frame()).toContain("n new Stage");
    expect(tui.frame()).toContain("esc back to sections");
    await tui.press(keys.escape, keys.escape);
    expect(onClose).toHaveBeenCalledOnce();
  });
  it.each(["keyboard", "mouse"])("opens Skills with the %s", async (input) => {
    const tui = await renderTui(<SettingsModal ctx={project.ctx} onChange={() => {}} onClose={() => {}} />);
    if (input === "keyboard") await tui.press(keys.down, keys.down, keys.down, keys.enter);
    else await tui.click("Skills");
    await vi.waitFor(() => expect(tui.frame()).toContain("not installed"));
    await tui.press("i");
    expect(tui.frame()).toContain("Install skill ›");
    await tui.press(keys.escape);
    expect(tui.frame()).toContain("esc back to sections");
  });
});
