import { cleanup } from "ink-testing-library";
import { afterEach, describe, expect, it, vi } from "vitest";
import { getProject } from "../../../../services/project/project.js";
import { useTestProject } from "../../../../services/testProject/testProject.js";
import { keys, renderTui, settle } from "../../../testing/index.js";
import { ProjectSection } from "./ProjectSection.js";

afterEach(cleanup);

describe("ProjectSection", () => {
  const project = useTestProject();

  it("shows the name and the key of the project", async () => {
    const tui = await renderTui(<ProjectSection ctx={project.ctx} onChange={() => {}} />);
    await settle(50);
    expect(tui.frame()).toMatch(/Name\s+Rowbly/);
    expect(tui.frame()).toMatch(/Key\s+ROW/);
  });

  it("edits the name with e and keeps the key", async () => {
    const onChange = vi.fn();
    const tui = await renderTui(<ProjectSection ctx={project.ctx} onChange={onChange} />);
    await settle(50);
    await tui.press("e");
    expect(tui.frame()).toContain("Edit Project");
    await tui.type(" 2");
    await tui.press(keys.ctrl("s"));
    await settle(50);
    expect(await getProject(project.ctx)).toMatchObject({ projectName: "Rowbly 2", projectKey: "ROW" });
    expect(onChange).toHaveBeenCalledOnce();
    await tui.press();
    expect(tui.frame()).toMatch(/Name\s+Rowbly 2/);
  });
});
