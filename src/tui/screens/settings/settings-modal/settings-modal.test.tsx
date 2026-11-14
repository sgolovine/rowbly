import { cleanup } from "ink-testing-library";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useTestProject } from "../../../../services/test-project/test-project.js";
import { keys, renderTui, settle } from "../../../testing/index.js";
import { SettingsModal } from "./settings-modal.js";

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
    for (const label of [
      "Project",
      "General",
      "Stages",
      "Custom Fields",
      "Skills",
      "Factory",
      "AI",
      "Git",
      "Maintenance",
      "Doctor",
    ]) {
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
  it("shows Git under AI in the Factory group, and the keys of the Git section", async () => {
    const tui = await renderTui(<SettingsModal ctx={project.ctx} onChange={() => {}} onClose={() => {}} />);
    await settle(50);
    expect(tui.frame()).toMatch(/Factory[\s\S]*AI[\s\S]*Git[\s\S]*Maintenance/);
    await tui.click("Git");
    await vi.waitFor(() => expect(tui.frame()).toContain("Commit author"));
    await tui.press();
    expect(tui.frame()).toMatch(/a author\s+m message\s+p toggle push\s+u toggle pull\s+i interval/);
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
