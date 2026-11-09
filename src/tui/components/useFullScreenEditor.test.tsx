import { Box, Text, useInput } from "ink";
import { cleanup } from "ink-testing-library";
import { afterEach, describe, expect, it, vi } from "vitest";
import { MainOverlayContext, useIsActive } from "../hooks/index.js";
import { keys, renderTui, settle } from "../testing/index.js";
import { useFullScreenEditor } from "./useFullScreenEditor.js";

afterEach(cleanup);

/** `o` opens the editor on "Hello"; the line shows whether the opener takes keys and whether the editor is open. */
function Opener({ onClose, onChange }: { onClose?(): void; onChange?(value: string): void }) {
  const editor = useFullScreenEditor();
  const active = useIsActive() && !editor.isOpen;
  useInput(
    (input) => {
      if (input === "o") editor.open({ title: "Notes", initial: "Hello", onClose, onChange });
    },
    { isActive: active },
  );
  return (
    <Box flexDirection="column">
      <Text>{`opener ${active ? "active" : "inactive"}, ${editor.isOpen ? "open" : "closed"}`}</Text>
      {editor.inline}
    </Box>
  );
}

describe("useFullScreenEditor", () => {
  it("opens the editor in the main overlay and calls onClose after it closes", async () => {
    const onClose = vi.fn();
    const tui = await renderTui(<Opener onClose={onClose} />);
    expect(tui.frame()).toContain("opener active, closed");
    await tui.press("o");
    expect(tui.frame()).toContain("Notes");
    expect(tui.frame()).toContain("Hello");
    expect(tui.frame()).toContain("opener inactive, open");
    // The overlay opens through two effects; give its keys a moment to start.
    await settle();
    await tui.press(keys.escape);
    expect(tui.frame()).not.toContain("Notes");
    expect(tui.frame()).toContain("opener active, closed");
    expect(onClose).toHaveBeenCalledOnce();
  });

  it("opens a new editor each time, without the text of the last one", async () => {
    const onChange = vi.fn();
    const tui = await renderTui(<Opener onChange={onChange} />);
    await tui.press("o");
    await settle();
    await tui.type("!");
    expect(onChange).toHaveBeenLastCalledWith("Hello!");
    await tui.press(keys.escape);
    await settle();
    await tui.press("o");
    await settle();
    expect(tui.frame()).toContain("Hello");
    expect(tui.frame()).not.toContain("Hello!");
  });

  it("renders the editor inline where there is no main overlay", async () => {
    const tui = await renderTui(
      <MainOverlayContext.Provider value={null}>
        <Opener />
      </MainOverlayContext.Provider>,
    );
    await tui.press("o");
    const lines = tui.frame().split("\n");
    expect(lines[0]).toContain("opener inactive, open");
    expect(lines[1]).toMatch(/^╭─Notes─/);
    await tui.press(keys.escape);
    expect(tui.frame()).toBe("opener active, closed");
  });
});
