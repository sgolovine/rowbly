import { cleanup } from "ink-testing-library";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ActiveContext } from "../../hooks/index.js";
import { renderTui } from "../../testing/index.js";
import { CloseButton } from "./CloseButton.js";

afterEach(cleanup);

describe("CloseButton", () => {
  it("shows the close mark", async () => {
    const tui = await renderTui(<CloseButton onClick={() => {}} />);
    expect(tui.frame()).toContain("✕");
  });

  it("calls onClick on a click", async () => {
    const onClick = vi.fn();
    const tui = await renderTui(<CloseButton onClick={onClick} />);
    await tui.click("✕");
    expect(onClick).toHaveBeenCalledOnce();
  });

  it("ignores a click while not active", async () => {
    const onClick = vi.fn();
    const tui = await renderTui(
      <ActiveContext.Provider value={false}>
        <CloseButton onClick={onClick} />
      </ActiveContext.Provider>,
    );
    await tui.click("✕");
    expect(onClick).not.toHaveBeenCalled();
  });
});
