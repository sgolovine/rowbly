import { cleanup } from "ink-testing-library";
import { afterEach, describe, expect, it, vi } from "vitest";
import { keys, renderTui } from "../../testing/index.js";
import { HelpModal } from "./HelpModal.js";

afterEach(cleanup);

describe("HelpModal", () => {
  it("shows the keys of the region first, then the global keys", async () => {
    const tui = await renderTui(<HelpModal hints={[{ key: "n", description: "new Stage" }]} onClose={() => {}} />);
    const frame = tui.frame();
    expect(frame).toContain("Keys");
    expect(frame.indexOf("new Stage")).toBeLessThan(frame.indexOf("find Stories"));
  });

  it.each([
    ["esc", keys.escape],
    ["?", "?"],
    ["q", "q"],
  ])("closes on %s", async (_, input) => {
    const onClose = vi.fn();
    const tui = await renderTui(<HelpModal hints={[]} onClose={onClose} />);
    await tui.press(input);
    expect(onClose).toHaveBeenCalledOnce();
  });
});
