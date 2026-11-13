import { cleanup } from "ink-testing-library";
import { afterEach, describe, expect, it, vi } from "vitest";
import { renderTui } from "../../testing/index.js";
import { EditorModeTab } from "./editor-mode-tab.js";

afterEach(cleanup);

describe("EditorModeTab", () => {
  it("shows the label with a leading space", async () => {
    const tui = await renderTui(<EditorModeTab label="Edit" selected active onClick={() => {}} />);
    expect(tui.frame()).toBe(" Edit");
  });

  it("calls onClick on a click while active", async () => {
    const onClick = vi.fn();
    const tui = await renderTui(<EditorModeTab label="View" selected={false} active onClick={onClick} />);
    await tui.click("View");
    expect(onClick).toHaveBeenCalledOnce();
  });

  it("ignores a click while not active", async () => {
    const onClick = vi.fn();
    const tui = await renderTui(<EditorModeTab label="View" selected={false} active={false} onClick={onClick} />);
    await tui.click("View");
    expect(onClick).not.toHaveBeenCalled();
  });
});
