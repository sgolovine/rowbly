import { Text } from "ink";
import { cleanup } from "ink-testing-library";
import { afterEach, describe, expect, it, vi } from "vitest";
import { keys, renderTui, settle } from "../../testing/index.js";
import { type EditorStateOptions, useEditorState } from "./use-editor-state.js";

afterEach(cleanup);

function Probe(options: Partial<EditorStateOptions>) {
  const editor = useEditorState({ initial: "a", initialMode: "edit", active: true, onClose: vi.fn(), ...options });
  return <Text>{`${editor.mode}|${editor.value}|${editor.dirty}|${editor.confirming}|${editor.save.kind}`}</Text>;
}

describe("useEditorState", () => {
  it("switches mode with tab", async () => {
    const tui = await renderTui(<Probe />);
    expect(tui.frame()).toBe("edit|a|false|false|idle");
    await tui.press(keys.tab);
    expect(tui.frame()).toBe("view|a|false|false|idle");
    await tui.press("e");
    expect(tui.frame()).toBe("edit|a|false|false|idle");
  });

  it("closes on esc when nothing is unsaved", async () => {
    const onClose = vi.fn();
    const tui = await renderTui(<Probe onClose={onClose} />);
    await tui.press(keys.escape);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("closes on ctrl+s without onSave", async () => {
    const onClose = vi.fn();
    const tui = await renderTui(<Probe onClose={onClose} />);
    await tui.press(keys.ctrl("s"));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("saves the initial text on ctrl+s with onSave", async () => {
    const onSave = vi.fn(async () => {});
    const tui = await renderTui(<Probe onSave={onSave} />);
    await tui.press(keys.ctrl("s"));
    await settle();
    expect(onSave).toHaveBeenCalledWith("a");
    expect(tui.frame()).toBe("edit|a|false|false|saved");
  });

  it("keeps the message of a failed save", async () => {
    const onSave = vi.fn(async () => {
      throw new Error("disk full");
    });
    const tui = await renderTui(<Probe onSave={onSave} />);
    await tui.press(keys.ctrl("s"));
    await settle();
    expect(tui.frame()).toBe("edit|a|false|false|failed");
  });
});
