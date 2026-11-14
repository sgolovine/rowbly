import { cleanup } from "ink-testing-library";
import { afterEach, describe, expect, it, vi } from "vitest";
import { renderTui } from "../../testing/index.js";
import { ViewModeSwitch, viewModeSwitchWidth } from "./view-mode-switch.js";

afterEach(cleanup);

describe("ViewModeSwitch", () => {
  it("shows Stories while off and Threads while on, with the key t", async () => {
    const tui = await renderTui(<ViewModeSwitch threads={false} showKey onToggle={() => {}} clickable />);
    expect(tui.frame()).toContain("●── Stories  t");
    await tui.rerender(<ViewModeSwitch threads showKey={false} onToggle={() => {}} clickable />);
    expect(tui.frame()).toContain("━━● Threads");
    expect(tui.frame()).not.toContain(" t ");
  });

  it("calls onToggle on a click, but not when it is not clickable", async () => {
    const onToggle = vi.fn();
    const tui = await renderTui(<ViewModeSwitch threads={false} showKey onToggle={onToggle} clickable />);
    await tui.click("Stories");
    expect(onToggle).toHaveBeenCalledOnce();
    await tui.rerender(<ViewModeSwitch threads={false} showKey onToggle={onToggle} clickable={false} />);
    await tui.click("Stories");
    expect(onToggle).toHaveBeenCalledOnce();
  });

  it("counts its columns with and without the key cap", () => {
    expect(viewModeSwitchWidth(true)).toBe(17);
    expect(viewModeSwitchWidth(false)).toBe(13);
  });
});
