import { Text } from "ink";
import { cleanup } from "ink-testing-library";
import { afterEach, describe, expect, it } from "vitest";
import { keys, renderTui, settle } from "../../testing/index.js";
import { ScrollBody } from "./scroll-body.js";

afterEach(cleanup);

const rows = Array.from({ length: 20 }, (_, i) => `row ${i + 1}`);

/** Renders 20 rows in a ScrollBody and waits until it has measured them, which turns its keys on. */
async function setup(props: { height?: number; active?: boolean } = {}) {
  const tui = await renderTui(
    <ScrollBody {...props}>
      {rows.map((row) => (
        <Text key={row}>{row}</Text>
      ))}
    </ScrollBody>,
  );
  await settle(50);
  return tui;
}

const visible = (frame: string) => frame.split("\n").filter((line) => line.startsWith("row "));

describe("ScrollBody", () => {
  it("shows all the content without a height, and no position line", async () => {
    const tui = await setup();
    expect(visible(tui.frame())).toHaveLength(20);
    expect(tui.frame()).not.toContain("pgup/pgdn");
  });

  it("shows one viewport and the position line with a fixed height", async () => {
    const tui = await setup({ height: 6 });
    expect(visible(tui.frame())).toEqual(["row 1", "row 2", "row 3", "row 4", "row 5"]);
    expect(tui.frame()).toContain("↑↓ 1–5 of 20 · pgup/pgdn scroll");
  });

  it("scrolls one viewport with pgdn and pgup, and stops at the ends", async () => {
    const tui = await setup({ height: 6 });
    await tui.press(keys.pageDown);
    expect(tui.frame()).toContain("↑↓ 6–10 of 20");
    expect(visible(tui.frame())[0]).toBe("row 6");
    await tui.press(keys.pageDown, keys.pageDown, keys.pageDown, keys.pageDown);
    expect(tui.frame()).toContain("↑↓ 16–20 of 20");
    await tui.press(keys.pageUp);
    expect(tui.frame()).toContain("↑↓ 11–15 of 20");
  });

  it("scrolls with the mouse wheel", async () => {
    const tui = await setup({ height: 6 });
    await tui.mouse("wheelDown", 1, 1);
    expect(tui.frame()).toContain("↑↓ 4–8 of 20");
    await tui.mouse("wheelUp", 1, 1);
    expect(tui.frame()).toContain("↑↓ 1–5 of 20");
  });

  it("takes no keys and no wheel while not active", async () => {
    const tui = await setup({ height: 6, active: false });
    await tui.press(keys.pageDown);
    await tui.mouse("wheelDown", 1, 1);
    expect(tui.frame()).toContain("↑↓ 1–5 of 20");
  });
});
