import { cleanup } from "ink-testing-library";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ValidationError } from "../../../services/errors/errors.js";
import { keys, renderTui } from "../../testing/index.js";
import { FormModal } from "./FormModal.js";

afterEach(cleanup);

const fields = [
  { name: "title", label: "Title", kind: "text" as const, required: true },
  { name: "body", label: "Body", kind: "multiline" as const },
];

function setup(onSubmit = vi.fn()) {
  const onClose = vi.fn();
  return {
    onSubmit,
    onClose,
    tui: renderTui(<FormModal title="New Story" fields={fields} onSubmit={onSubmit} onClose={onClose} />),
  };
}

describe("FormModal", () => {
  it("shows the title, the fields and the save key", async () => {
    const frame = (await setup().tui).frame();
    expect(frame).toContain("New Story");
    expect(frame).toContain("Title");
    expect(frame).toContain("Body");
    expect(frame).toContain("[Full screen]");
    expect(frame).toContain("ctrl+s save");
  });

  it("submits the values with ctrl+s", async () => {
    const { tui, onSubmit } = setup();
    const t = await tui;
    await t.type("Fix login");
    await t.press(keys.ctrl("s"));
    expect(onSubmit).toHaveBeenCalledWith({ title: "Fix login", body: "" });
  });

  it("submits the values with enter when submitOnEnter is set", async () => {
    const onSubmit = vi.fn();
    const t = await renderTui(
      <FormModal title="New Story" fields={fields} onSubmit={onSubmit} onClose={() => {}} submitOnEnter />,
    );
    await t.type("Fix login");
    await t.press(keys.enter);
    expect(onSubmit).toHaveBeenCalledWith({ title: "Fix login", body: "" });
  });

  it("shows the issues of a ValidationError under the fields", async () => {
    const onSubmit = vi.fn(() => {
      throw new ValidationError("bad", { details: { issues: [{ path: ["title"], message: "Title is taken" }] } });
    });
    const t = await setup(onSubmit).tui;
    await t.type("Fix login");
    await t.press(keys.ctrl("s"));
    expect(t.frame()).toContain("Title is taken");
  });

  it("closes on esc when nothing changed", async () => {
    const { tui, onClose } = setup();
    await (await tui).press(keys.escape);
    expect(onClose).toHaveBeenCalledOnce();
  });

  it("asks before it discards changes on esc", async () => {
    const { tui, onClose } = setup();
    const t = await tui;
    await t.type("Draft");
    await t.press(keys.escape);
    expect(t.frame()).toContain("Close and discard unsaved changes?");
    expect(onClose).not.toHaveBeenCalled();
    await t.press("n");
    expect(t.frame()).not.toContain("Close and discard unsaved changes?");
    await t.press(keys.escape, "y");
    expect(onClose).toHaveBeenCalledOnce();
  });

  it("shows no Delete Button without onDelete", async () => {
    const t = await setup().tui;
    expect(t.frame()).not.toContain("ctrl+d");
  });

  it("asks before it deletes with ctrl+d or the Delete Button", async () => {
    const onConfirm = vi.fn();
    const t = await renderTui(
      <FormModal
        title="Edit ROW-01"
        fields={fields}
        onSubmit={() => {}}
        onClose={() => {}}
        onDelete={{ title: "Delete Story › ROW-01", message: "Delete ROW-01?", onConfirm }}
      />,
    );
    expect(t.frame()).toMatch(/Delete +ctrl\+d/);
    await t.press(keys.ctrl("d"));
    expect(t.frame()).toContain("Delete ROW-01?");
    await t.press(keys.escape);
    expect(t.frame()).not.toContain("Delete ROW-01?");
    await t.click("Delete");
    expect(t.frame()).toContain("Delete ROW-01?");
    await t.press("y");
    expect(onConfirm).toHaveBeenCalledOnce();
    expect(t.frame()).not.toContain("Delete ROW-01?");
  });
});
