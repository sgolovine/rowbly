import { Text } from "ink";
import { cleanup } from "ink-testing-library";
import { afterEach, describe, expect, it, vi } from "vitest";
import { renderTui } from "../testing/index.js";
import { useMarkdownRenderer } from "./use-markdown-renderer.js";

afterEach(cleanup);

function Probe() {
  const render = useMarkdownRenderer();

  return <Text>{render ? render("**bold**", 20).join("|") : "plain"}</Text>;
}

describe("useMarkdownRenderer", () => {
  it("loads the renderer and renders with it", async () => {
    const tui = await renderTui(<Probe />);

    await vi.waitFor(async () => {
      await tui.press();
      expect(tui.frame()).toContain("bold");
      expect(tui.frame()).not.toContain("plain");
    });
  });
});
