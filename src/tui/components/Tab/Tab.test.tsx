import { cleanup } from "ink-testing-library";
import { afterEach, describe, expect, it, vi } from "vitest";
import { renderTui } from "../../testing/index.js";
import { Tab } from "./Tab.js";

afterEach(cleanup);

describe("Tab", () => {
  it("shows the label", async () => {
    const tui = await renderTui(<Tab label="Details" selected active onClick={() => {}} />);
    expect(tui.frame()).toBe(" Details");
  });

  it("calls onClick on a click while active", async () => {
    const onClick = vi.fn();
    const tui = await renderTui(<Tab label="Details" selected={false} active onClick={onClick} />);
    await tui.click("Details");
    expect(onClick).toHaveBeenCalledOnce();
  });

  it("ignores a click while not active", async () => {
    const onClick = vi.fn();
    const tui = await renderTui(<Tab label="Details" selected={false} active={false} onClick={onClick} />);
    await tui.click("Details");
    expect(onClick).not.toHaveBeenCalled();
  });
});
