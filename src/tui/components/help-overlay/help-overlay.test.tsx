import { cleanup } from "ink-testing-library";
import { afterEach, describe, expect, it } from "vitest";
import { GLOBAL_KEYS } from "../../keymap.js";
import { renderTui } from "../../testing/index.js";
import { HelpOverlay } from "./help-overlay.js";

afterEach(cleanup);

describe("HelpOverlay", () => {
  it("lists the screen keys first, then the global keys, in aligned columns", async () => {
    const tui = await renderTui(
      <HelpOverlay
        hints={[{ key: "n", description: "new story" }]}
        globals={[
          { key: "enter", description: "select" },
          { key: "?", description: "help" },
        ]}
      />,
    );
    expect(tui.frame().split("\n")).toEqual(["n      new story", "enter  select", "?      help"]);
  });

  it("lets a screen key replace the global meaning of the same key", async () => {
    const tui = await renderTui(
      <HelpOverlay
        hints={[{ key: "esc", description: "cancel" }]}
        globals={[
          { key: "esc", description: "back" },
          { key: "?", description: "help" },
        ]}
      />,
    );
    expect(tui.frame()).toContain("esc  cancel");
    expect(tui.frame()).not.toContain("back");
  });

  it("shows all the global keys by default, also the secondary ones", async () => {
    const tui = await renderTui(<HelpOverlay hints={[]} />);
    for (const hint of GLOBAL_KEYS) expect(tui.frame()).toContain(hint.description);
  });
});
