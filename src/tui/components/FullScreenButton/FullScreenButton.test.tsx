import { cleanup } from "ink-testing-library";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ActiveContext } from "../../hooks/index.js";
import { renderTui } from "../../testing/index.js";
import { FullScreenButton } from "./FullScreenButton.js";

afterEach(cleanup);

describe("FullScreenButton", () => {
  it("shows the label, and the ctrl+f key only when focused", async () => {
    const tui = await renderTui(<FullScreenButton focused={false} clickable onClick={() => {}} />);
    expect(tui.frame()).toContain("[Full screen]");
    expect(tui.frame()).not.toContain("ctrl+f");
    await tui.rerender(<FullScreenButton focused clickable onClick={() => {}} />);
    expect(tui.frame()).toContain("[Full screen] ctrl+f");
  });

  it("calls onClick on a click while clickable", async () => {
    const onClick = vi.fn();
    const tui = await renderTui(<FullScreenButton focused={false} clickable onClick={onClick} />);
    await tui.click("[Full screen]");
    expect(onClick).toHaveBeenCalledOnce();
  });

  it("ignores a click while not clickable or not active", async () => {
    const onClick = vi.fn();
    const tui = await renderTui(<FullScreenButton focused={false} clickable={false} onClick={onClick} />);
    await tui.click("[Full screen]");
    await tui.rerender(
      <ActiveContext.Provider value={false}>
        <FullScreenButton focused={false} clickable onClick={onClick} />
      </ActiveContext.Provider>,
    );
    await tui.click("[Full screen]");
    expect(onClick).not.toHaveBeenCalled();
  });
});
