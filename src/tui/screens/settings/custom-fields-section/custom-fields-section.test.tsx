import { cleanup } from "ink-testing-library";
import { afterEach, describe, expect, it, vi } from "vitest";
import { addCustomField, listCustomFields } from "../../../../services/custom-field/custom-field.js";
import { useTestProject } from "../../../../services/test-project/test-project.js";
import { keys, renderTui, settle } from "../../../testing/index.js";
import { CustomFieldsSection } from "./custom-fields-section.js";

afterEach(cleanup);

describe("CustomFieldsSection", () => {
  const project = useTestProject();

  async function setup() {
    const onChange = vi.fn();
    const tui = await renderTui(<CustomFieldsSection ctx={project.ctx} onChange={onChange} />);
    await settle(50);
    await tui.press();
    return { tui, onChange };
  }

  it("tells the user how to add a field when there are none", async () => {
    const { tui } = await setup();
    expect(tui.frame()).toContain("No Custom Fields. Press n to add one.");
  });

  it("lists the fields with their keys and types", async () => {
    await addCustomField({ label: "Points", type: "number" }, project.ctx);
    await addCustomField({ label: "Size", type: "select", options: ["S", "M"] }, project.ctx);
    const { tui } = await setup();
    expect(tui.frame()).toMatch(/▌ Points\s+points\s+number/);
    expect(tui.frame()).toMatch(/Size\s+size\s+select: S, M/);
  });

  it("adds a field with n", async () => {
    const { tui, onChange } = await setup();
    await tui.press("n");
    expect(tui.frame()).toContain("New Custom Field");
    await tui.type("Points");
    await tui.press(keys.ctrl("s"));
    await settle(50);
    expect(await listCustomFields(project.ctx)).toEqual([{ key: "points", label: "Points", type: "string" }]);
    expect(onChange).toHaveBeenCalledOnce();
  });

  it("adds a field with the + New Custom Field Button", async () => {
    const { tui } = await setup();
    expect(tui.frame()).toMatch(/\+ New Custom Field\s+n/);
    await tui.click("+ New Custom Field");
    expect(tui.frame()).toContain("╭─New Custom Field");
    await tui.type("Points");
    await tui.press(keys.ctrl("s"));
    await settle(50);
    expect((await listCustomFields(project.ctx)).map((f) => f.key)).toEqual(["points"]);
  });

  it("edits a field on a click on its row", async () => {
    await addCustomField({ label: "Points", type: "number" }, project.ctx);
    await addCustomField({ label: "Size", type: "string" }, project.ctx);
    const { tui } = await setup();
    await tui.click("Size");
    expect(tui.frame()).toContain("Edit Custom Field › Size");
  });

  it("removes the selected field after a confirmation", async () => {
    await addCustomField({ label: "Points", type: "number" }, project.ctx);
    const { tui } = await setup();
    await tui.press("d");
    expect(tui.frame()).toContain("Remove Points?");
    await tui.press("y");
    await settle(50);
    expect(await listCustomFields(project.ctx)).toEqual([]);
  });
});
