import { cleanup } from "ink-testing-library";
import { afterEach, describe, expect, it, vi } from "vitest";
import { addCustomField, listCustomFields } from "../../../../services/custom-field/custom-field.js";
import { useTestProject } from "../../../../services/test-project/test-project.js";
import { keys, renderTui, settle } from "../../../testing/index.js";
import { CustomFieldFormModal } from "./custom-field-form-modal.js";

afterEach(cleanup);

describe("CustomFieldFormModal", () => {
  const project = useTestProject();

  it("adds a select field with its options", async () => {
    const onSaved = vi.fn();
    const tui = await renderTui(<CustomFieldFormModal ctx={project.ctx} onSaved={onSaved} onClose={() => {}} />);
    expect(tui.frame()).toContain("New Custom Field");
    await tui.type("Size");
    // Type cycles string → number → boolean → url → date → select.
    await tui.press(keys.tab, keys.left, keys.tab);
    await tui.type("S, M, L");
    await tui.press(keys.ctrl("s"));
    await settle(50);
    const field = { key: "size", label: "Size", type: "select", options: ["S", "M", "L"] };
    expect(await listCustomFields(project.ctx)).toEqual([field]);
    expect(onSaved).toHaveBeenCalledWith(field);
  });

  it("edits a field, with its values in the form", async () => {
    const field = await addCustomField({ label: "Points", type: "number" }, project.ctx);
    const tui = await renderTui(
      <CustomFieldFormModal ctx={project.ctx} field={field} onSaved={() => {}} onClose={() => {}} />,
    );
    expect(tui.frame()).toContain("Edit Custom Field › Points");
    expect(tui.frame()).toContain("number");
    await tui.type(" left");
    await tui.press(keys.ctrl("s"));
    await settle(50);
    expect((await listCustomFields(project.ctx))[0]).toMatchObject({ key: "points", label: "Points left" });
  });

  it("shows the error of the service", async () => {
    const tui = await renderTui(<CustomFieldFormModal ctx={project.ctx} onSaved={() => {}} onClose={() => {}} />);
    await tui.type("Title");
    await tui.press(keys.ctrl("s"));
    await settle(50);
    expect(tui.frame() + tui.toasts.list().map((t) => t.message)).toContain("reserved");
  });
});
