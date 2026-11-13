import { cleanup } from "ink-testing-library";
import { afterEach, describe, expect, it, vi } from "vitest";
import { keys, renderTui, settle } from "../../testing/index.js";
import { FullScreenEditor, type FullScreenEditorProps } from "./full-screen-editor.js";

afterEach(cleanup);

function setup(props: Partial<FullScreenEditorProps> = {}) {
  const onClose = vi.fn();
  const onChange = vi.fn();
  const tui = renderTui(
    <FullScreenEditor title="Description" initial="Hello" onClose={onClose} onChange={onChange} {...props} />,
  );
  return { onClose, onChange, tui };
}

describe("FullScreenEditor", () => {
  it("opens in edit mode with the text, the modes and the keys", async () => {
    const tui = await setup().tui;
    const frame = tui.frame();
    expect(frame.split("\n")[0]).toMatch(/^╭─Description─+ ✕ ╮$/);
    expect(frame).toContain(" View   Edit ");
    expect(frame).toContain("Hello");
    expect(frame).toContain("tab view");
    expect(frame).toContain("ctrl+s close");
    expect(frame).toContain("esc close");
  });

  it("sends each edit to onChange", async () => {
    const { tui: pending, onChange } = setup();
    const tui = await pending;
    await tui.type("!");
    expect(onChange).toHaveBeenLastCalledWith("Hello!");
    expect(tui.frame()).toContain("Hello!");
  });

  it("switches to view with tab, and back to edit with tab or e", async () => {
    const tui = await setup({ initial: "" }).tui;
    await tui.press(keys.tab);
    expect(tui.frame()).toContain("No text yet. Press e to write some.");
    expect(tui.frame()).toContain("tab/e edit");
    expect(tui.frame()).toContain("↑/↓ scroll");
    await tui.press("e");
    expect(tui.frame()).toContain("tab view");
    await tui.press(keys.tab, keys.tab);
    expect(tui.frame()).toContain("tab view");
  });

  it("opens in view mode, and switches mode on a click on a mode", async () => {
    const tui = await setup({ mode: "view" }).tui;
    expect(tui.frame()).toContain("tab/e edit");
    await tui.click("Edit ");
    expect(tui.frame()).toContain("tab view");
    await tui.click("View ");
    expect(tui.frame()).toContain("tab/e edit");
  });

  it("closes on esc, ctrl+f, ctrl+s and the ✕ without onSave", async () => {
    const { tui: pending, onClose } = setup();
    const tui = await pending;
    await tui.press(keys.escape);
    await tui.press(keys.ctrl("f"));
    await tui.press(keys.ctrl("s"));
    await tui.click("✕");
    expect(onClose).toHaveBeenCalledTimes(4);
  });

  it("saves on ctrl+s with onSave and shows unsaved, then saved", async () => {
    const onSave = vi.fn(async () => {});
    const { tui: pending, onClose } = setup({ onSave });
    const tui = await pending;
    expect(tui.frame()).toContain("ctrl+s save");
    await tui.type("!");
    expect(tui.frame()).toContain("unsaved");
    await tui.press(keys.ctrl("s"));
    // The keys are off while it saves; give them a moment to come back.
    await settle(50);
    expect(onSave).toHaveBeenCalledWith("Hello!");
    expect(tui.frame()).toContain("saved");
    expect(tui.frame()).not.toContain("unsaved");
    expect(onClose).not.toHaveBeenCalled();
    await tui.press(keys.escape);
    expect(onClose).toHaveBeenCalledOnce();
  });

  it("asks before it discards unsaved changes", async () => {
    const { tui: pending, onClose } = setup({ onSave: async () => {} });
    const tui = await pending;
    await tui.type("!");
    await tui.press(keys.escape);
    expect(tui.frame()).toContain("Close and discard unsaved changes?");
    expect(tui.frame()).not.toContain("✕");
    await tui.press("n");
    expect(tui.frame()).toContain("Hello!");
    expect(onClose).not.toHaveBeenCalled();
    await tui.press(keys.escape, "y");
    expect(onClose).toHaveBeenCalledOnce();
  });

  it("shows the message of a failed save and keeps the text unsaved", async () => {
    const onSave = vi.fn(async () => {
      throw new Error("disk full");
    });
    const { tui: pending, onClose } = setup({ onSave });
    const tui = await pending;
    await tui.type("!");
    await tui.press(keys.ctrl("s"));
    await settle(50);
    expect(tui.frame()).toContain("not saved: disk full");
    await tui.press(keys.escape);
    expect(tui.frame()).toContain("Close and discard unsaved changes?");
    expect(onClose).not.toHaveBeenCalled();
  });
});
