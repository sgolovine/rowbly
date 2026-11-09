import { rm } from "node:fs/promises";
import { join } from "node:path";
import { cleanup } from "ink-testing-library";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useTestProject } from "../../../../services/testProject/testProject.js";
import { renderTui, settle } from "../../../testing/index.js";
import { DoctorSection } from "./DoctorSection.js";

afterEach(cleanup);

describe("DoctorSection", () => {
  const project = useTestProject();

  it("reports a healthy project", async () => {
    const tui = await renderTui(<DoctorSection ctx={project.ctx} onChange={() => {}} />);
    await settle(50);
    await tui.press();
    expect(tui.frame()).toContain("No problems.");
    expect(tui.frame()).toContain("Check again");
  });

  it("shows an issue and fixes it with f", async () => {
    await rm(join(project.ctx.cwd as string, ".rowbly", "stories"), { recursive: true });
    const onChange = vi.fn();
    const tui = await renderTui(<DoctorSection ctx={project.ctx} onChange={onChange} />);
    await settle(50);
    await tui.press();
    expect(tui.frame()).toContain("✕ Folder is missing");
    expect(tui.frame()).toContain(".rowbly/stories · fix: Create it");
    await tui.press("f");
    await settle(50);
    await tui.press();
    expect(tui.frame()).toContain("✓ Folder is missing");
    expect(onChange).toHaveBeenCalledOnce();
    await tui.press("r");
    await settle(50);
    await tui.press();
    expect(tui.frame()).toContain("No problems.");
  });
});
