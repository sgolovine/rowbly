import { Text } from "ink";
import { cleanup } from "ink-testing-library";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useIsActive, useKeyHints } from "../../../hooks/index.js";
import type { KeyHint } from "../../../keymap.js";
import { keys, renderTui } from "../../../testing/index.js";
import type { SettingsGroup } from "../settings-sections.js";
import { SettingsBody } from "./settings-body.js";

afterEach(cleanup);

function Alpha() {
  useKeyHints([{ key: "x", description: "do alpha" }]);
  return <Text>{useIsActive() ? "alpha in focus" : "alpha content"}</Text>;
}
const Beta = () => <Text>beta content</Text>;
const GROUPS: SettingsGroup[] = [
  { title: "One", sections: [{ id: "alpha", label: "Alpha", description: "About alpha.", Component: Alpha }] },
  { title: "Two", sections: [{ id: "beta", label: "Beta", description: "About beta.", Component: Beta }] },
];

async function setup(section?: string) {
  const onClose = vi.fn();
  let hints: readonly KeyHint[] = [];
  const tui = await renderTui(
    <SettingsBody
      ctx={{}}
      groups={GROUPS}
      section={section}
      onChange={() => {}}
      onClose={onClose}
      onHints={(next) => {
        hints = next;
      }}
    />,
  );
  return { tui, onClose, hints: () => hints.map((h) => `${h.key} ${h.description}`) };
}

describe("SettingsBody", () => {
  it("shows the first section in a Panel with its title, and the list has the focus", async () => {
    const { tui, hints } = await setup();
    expect(tui.frame()).toContain("▌ Alpha");
    expect(tui.frame()).toMatch(/╭─+╮\s*╭─Alpha─+╮/);
    expect(tui.frame()).toContain("About alpha.");
    expect(tui.frame()).toContain("alpha content");
    expect(hints()).toEqual(["↑/↓ section", "enter open section", "esc close"]);
  });

  it("selects a section with the arrow keys", async () => {
    const { tui } = await setup();
    await tui.press(keys.down);
    expect(tui.frame()).toContain("▌ Beta");
    expect(tui.frame()).toContain("About beta.");
    expect(tui.frame()).toContain("beta content");
  });

  it("opens the section with enter, shows its keys, and goes back with esc", async () => {
    const { tui, hints, onClose } = await setup();
    await tui.press(keys.enter);
    expect(tui.frame()).toContain("alpha in focus");
    expect(hints()).toEqual(["x do alpha", "tab sections", "esc back to sections"]);
    await tui.press(keys.escape);
    expect(tui.frame()).toContain("alpha content");
    expect(onClose).not.toHaveBeenCalled();
    await tui.press(keys.escape);
    expect(onClose).toHaveBeenCalledOnce();
  });

  it("opens a section on a click", async () => {
    const { tui } = await setup();
    await tui.click("Beta");
    expect(tui.frame()).toContain("beta content");
    await tui.press(keys.tab);
    await tui.press(keys.up);
    expect(tui.frame()).toContain("▌ Alpha");
  });

  it("moves the focus between the Panels on a click", async () => {
    const { tui, hints } = await setup();
    await tui.click("About alpha.");
    expect(tui.frame()).toContain("alpha in focus");
    expect(hints()).toContain("esc back to sections");
    await tui.click("Two");
    expect(tui.frame()).toContain("alpha content");
    expect(hints()).toContain("esc close");
  });

  it("opens a section with the focus when the Modal opens on it", async () => {
    const { tui, hints } = await setup("beta");
    expect(tui.frame()).toContain("▌ Beta");
    expect(tui.frame()).toContain("beta content");
    expect(hints()).toContain("esc back to sections");
  });
});
