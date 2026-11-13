import { cleanup } from "ink-testing-library";
import { afterEach, describe, expect, it, vi } from "vitest";
import { getProject } from "../../../../services/project/project.js";
import { useTestProject } from "../../../../services/test-project/test-project.js";
import { keys, renderTui, settle } from "../../../testing/index.js";
import { SpecsSection } from "./specs-section.js";

afterEach(cleanup);

describe("SpecsSection", () => {
  const project = useTestProject();

  async function setup() {
    const onChange = vi.fn();
    const tui = await renderTui(<SpecsSection ctx={project.ctx} onChange={onChange} />);
    await settle(50);
    await tui.press();
    return { tui, onChange };
  }

  it("shows that Specs are off in a new project", async () => {
    const { tui } = await setup();
    expect(tui.frame()).toMatch(/Specs\s+●── Disabled/);
  });

  it("turns Specs on with space and off with enter", async () => {
    const { tui, onChange } = await setup();
    await tui.press(" ");
    await settle(50);
    await tui.press();
    expect((await getProject(project.ctx)).features).toEqual({ specs: true });
    expect(tui.frame()).toContain("━━● Enabled");
    expect(onChange).toHaveBeenCalledOnce();
    await tui.press(keys.enter);
    await settle(50);
    expect((await getProject(project.ctx)).features).toEqual({ specs: false });
  });

  it("turns Specs on with a click on the Switch", async () => {
    const { tui } = await setup();
    await tui.click("Disabled");
    await settle(50);
    expect((await getProject(project.ctx)).features).toEqual({ specs: true });
  });
});
