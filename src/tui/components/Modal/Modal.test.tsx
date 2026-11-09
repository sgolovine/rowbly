import { Box, Text } from "ink";
import { cleanup } from "ink-testing-library";
import { afterEach, describe, expect, it, vi } from "vitest";
import { LayoutContext } from "../../hooks/index.js";
import { keys, renderTui, settle } from "../../testing/index.js";
import { ConfirmDialog } from "../ConfirmDialog/index.js";
import { Modal } from "./Modal.js";

afterEach(cleanup);

describe("Modal", () => {
  it("shows the title in the top edge, the content and the hints", async () => {
    const tui = await renderTui(
      <Modal title="Edit story" hints={[{ key: "ctrl+s", description: "save" }]}>
        <Text>Body text</Text>
      </Modal>,
    );
    const lines = tui.frame().split("\n");
    expect(lines[0]).toMatch(/^╭─Edit story─+╮/);
    expect(tui.frame()).toContain("Body text");
    expect(tui.frame()).toContain("ctrl+s save");
  });

  it("pads the body by default, and a flush modal puts its content against the frame", async () => {
    const padded = await renderTui(
      <Modal title="Padded">
        <Text>content</Text>
      </Modal>,
    );
    expect(padded.frame()).toMatch(/│ {2}content/);
    cleanup();
    const flush = await renderTui(
      <Modal title="Flush" flush>
        <Text>content</Text>
      </Modal>,
    );
    expect(flush.frame()).toMatch(/│content/);
  });

  it("gives an info modal a Close button that calls onClose", async () => {
    const onClose = vi.fn();
    const tui = await renderTui(
      <Modal title="About" onClose={onClose}>
        <Text>Rowbly</Text>
      </Modal>,
    );
    expect(tui.frame()).not.toContain("esc close");
    await tui.click("Close");
    expect(onClose).toHaveBeenCalledOnce();
  });

  it("calls onClose on a click on the ✕ in the border", async () => {
    const onClose = vi.fn();
    const tui = await renderTui(
      <Modal title="About" onClose={onClose}>
        <Text>Rowbly</Text>
      </Modal>,
    );
    await tui.click("✕");
    expect(onClose).toHaveBeenCalledOnce();
  });

  it("shows `esc close` for a titled modal without hints or onClose", async () => {
    const tui = await renderTui(
      <Modal title="About">
        <Text>Rowbly</Text>
      </Modal>,
    );
    expect(tui.frame()).toContain("esc close");
  });

  it("goes quiet under a nested modal: only the top one shows its ✕ and hints", async () => {
    const tui = await renderTui(
      <Modal title="Outer" hints={[{ key: "o", description: "outer key" }]} onClose={() => {}}>
        <Text>Outer body</Text>
        <Modal title="Inner" hints={[{ key: "i", description: "inner key" }]} onClose={() => {}}>
          <Text>Inner body</Text>
        </Modal>
      </Modal>,
    );
    const frame = tui.frame();
    expect(frame).toContain("Inner body");
    expect(frame).toContain("i inner key");
    expect(frame).not.toContain("o outer key");
    expect(frame.match(/✕/g)).toHaveLength(1);
  });

  it("draws a nested dialog whole over a short modal, without a render loop", async () => {
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    const tui = await renderTui(
      <LayoutContext.Provider value={{ width: 100, height: 30 }}>
        <Box width={100} height={30}>
          <Modal title="New Spec">
            <Text>Title</Text>
            <ConfirmDialog
              title="Discard changes"
              message="Close and discard unsaved changes?"
              confirmLabel="Discard"
              cancelLabel="Keep editing"
              onConfirm={() => {}}
              onCancel={() => {}}
            />
          </Modal>
        </Box>
      </LayoutContext.Provider>,
    );
    await settle(100);
    expect(tui.frame()).toContain("Discard changes");
    expect(tui.frame()).toContain("Close and discard unsaved changes?");
    expect(tui.frame()).toMatch(/Discard {2}y /);
    expect(tui.frame()).toMatch(/Keep editing {2}n /);
    expect(errors.mock.calls.flat().join("\n")).not.toContain("Maximum update depth");
    errors.mockRestore();
  });

  it.each([8, 10])("does not start a render loop for a dialog in a %i-row area", async (height) => {
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    const tui = await renderTui(
      <LayoutContext.Provider value={{ width: 100, height }}>
        <Box width={100} height={height}>
          <ConfirmDialog title="Discard changes" message="Discard?" onConfirm={() => {}} onCancel={() => {}} />
        </Box>
      </LayoutContext.Provider>,
    );
    await settle(100);
    expect(errors.mock.calls.flat().join("\n")).not.toContain("Maximum update depth");
    if (height === 10) expect(tui.frame()).toMatch(/Yes {2}y /);
    errors.mockRestore();
  });

  it("scrolls a long body when it is shown over a fixed height", async () => {
    const rows = Array.from({ length: 40 }, (_, i) => `row ${i + 1}`);
    const tui = await renderTui(
      // The overlay is placed absolutely, so the box around it gives the frame its height.
      <Box height={20}>
        <LayoutContext.Provider value={{ width: 80, height: 20 }}>
          <Modal title="Long">
            {rows.map((row) => (
              <Text key={row}>{row}</Text>
            ))}
          </Modal>
        </LayoutContext.Provider>
      </Box>,
    );
    await settle(50);
    expect(tui.frame()).toContain("row 1");
    expect(tui.frame()).not.toContain("row 40");
    expect(tui.frame()).toMatch(/↑↓ 1–\d+ of 40/);
    await tui.press(keys.pageDown);
    expect(tui.frame()).not.toMatch(/↑↓ 1–/);
  });
});
