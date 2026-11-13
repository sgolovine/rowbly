import { cleanup } from "ink-testing-library";
import { afterEach, describe, expect, it, vi } from "vitest";
import { renderTui } from "../../testing/index.js";
import { StoryFinderButton } from "./story-finder-button.js";

afterEach(cleanup);

describe("StoryFinderButton", () => {
  it("shows its label and key, or only the glyph when compact", async () => {
    const tui = await renderTui(<StoryFinderButton compact={false} clickable onClick={() => {}} />);
    expect(tui.frame()).toContain("🔎 Find Stories   ctrl+p");
    await tui.rerender(<StoryFinderButton compact clickable onClick={() => {}} />);
    expect(tui.frame().trim()).toBe("🔎");
  });

  it("calls onClick on a click only while clickable", async () => {
    const onClick = vi.fn();
    const tui = await renderTui(<StoryFinderButton compact={false} clickable={false} onClick={onClick} />);
    await tui.click("Find");
    expect(onClick).not.toHaveBeenCalled();
    await tui.rerender(<StoryFinderButton compact={false} clickable onClick={onClick} />);
    await tui.click("Find");
    expect(onClick).toHaveBeenCalledOnce();
  });
});
