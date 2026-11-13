import { stripVTControlCharacters } from "node:util";
import { cleanup } from "ink-testing-library";
import { afterEach, describe, expect, it } from "vitest";
import { keys, renderTui } from "../../testing/index.js";
import { loadMarkdownRenderer } from "../markdown.js";
import { MarkdownView } from "./markdown-view.js";

afterEach(cleanup);

const text = "# Title\n\nSome **bold** text.\n\n- one\n- two";
const long = Array.from({ length: 12 }, (_, i) => `line ${i + 1}`).join("\n\n");

describe("MarkdownView", () => {
  // Runs first: the renderer loads once per test file.
  it("shows the text without its syntax until the renderer has loaded", async () => {
    const tui = await renderTui(<MarkdownView text={text} width={40} />);
    const first = stripVTControlCharacters(tui.ink.frames[0] ?? "");
    expect(first).toContain("Title");
    expect(first).not.toContain("# Title");
    expect(first).toContain("• one");
  });

  it("renders the markdown once the renderer has loaded", async () => {
    await loadMarkdownRenderer();
    const tui = await renderTui(<MarkdownView text={text} width={40} />);
    expect(tui.frame()).toContain("# Title");
    expect(tui.frame()).toContain("Some bold text.");
    expect(tui.frame()).not.toContain("**");
  });

  it("shows emptyText for empty text", async () => {
    const tui = await renderTui(<MarkdownView text={"  \n"} width={40} emptyText="No body yet." />);
    expect(tui.frame()).toBe("No body yet.");
  });

  it("shows all the rows without a height", async () => {
    await loadMarkdownRenderer();
    const tui = await renderTui(<MarkdownView text={long} width={40} />);
    expect(tui.frame()).toContain("line 12");
    expect(tui.frame()).not.toContain("scroll");
  });

  it("scrolls with ↑/↓, j/k and pgup/pgdn in a fixed height", async () => {
    await loadMarkdownRenderer();
    const tui = await renderTui(<MarkdownView text={long} width={40} height={6} />);
    expect(tui.frame()).toContain("1–5 of 23 · ↑/↓ scroll");
    expect(tui.frame()).not.toContain("line 4");
    await tui.press(keys.down, "j");
    expect(tui.frame()).toContain("3–7 of 23");
    await tui.press("k");
    expect(tui.frame()).toContain("2–6 of 23");
    await tui.press(keys.pageDown, keys.pageDown, keys.pageDown, keys.pageDown, keys.pageDown);
    expect(tui.frame()).toContain("19–23 of 23");
    expect(tui.frame()).toContain("line 12");
    await tui.press(keys.pageUp);
    expect(tui.frame()).toContain("14–18 of 23");
  });

  it("scrolls with the mouse wheel", async () => {
    await loadMarkdownRenderer();
    const tui = await renderTui(<MarkdownView text={long} width={40} height={6} />);
    await tui.mouse("wheelDown", 1, 1);
    expect(tui.frame()).toContain("4–8 of 23");
  });

  it("takes no keys while not active", async () => {
    await loadMarkdownRenderer();
    const tui = await renderTui(<MarkdownView text={long} width={40} height={6} active={false} />);
    await tui.press(keys.down, keys.pageDown);
    expect(tui.frame()).toContain("1–5 of 23");
  });
});
