import { cleanup } from "ink-testing-library";
import { afterEach, describe, expect, it, vi } from "vitest";
import { renderTui } from "../../testing/index.js";
import { ModalFooter } from "./modal-footer.js";

afterEach(cleanup);

const HINTS = [
  { key: "d", description: "delete" },
  { key: "esc", description: "close" },
];

describe("ModalFooter", () => {
  it("shows the hint strip of the top layer", async () => {
    const tui = await renderTui(<ModalFooter hints={HINTS} top width={60} />);

    expect(tui.frame()).toContain("d delete");
    expect(tui.frame()).toContain("esc close");
  });

  it("keeps the line but hides the hints under another layer", async () => {
    const tui = await renderTui(<ModalFooter hints={HINTS} top={false} width={60} />);

    expect(tui.frame()).not.toContain("delete");
    expect(tui.frame()).toContain("─");
  });

  it("shows a Close Button for an info modal", async () => {
    const onClose = vi.fn();
    const tui = await renderTui(<ModalFooter hints={HINTS.slice(1)} onClose={onClose} top width={60} />);

    await tui.click("Close");

    expect(onClose).toHaveBeenCalled();
  });
});
