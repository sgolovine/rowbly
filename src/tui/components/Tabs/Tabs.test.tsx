import { cleanup } from "ink-testing-library";
import { afterEach, describe, expect, it, vi } from "vitest";
import { renderTui } from "../../testing/index.js";
import { Tabs } from "./Tabs.js";

afterEach(cleanup);

const tabs = ["Details", "Prompt", "History"];

describe("Tabs", () => {
  it("shows all the tab labels in a row", async () => {
    const tui = await renderTui(<Tabs tabs={tabs} selected={0} onSelect={() => {}} active />);
    expect(tui.frame()).toBe(" Details   Prompt   History");
  });

  it("selects the clicked tab by its index while active", async () => {
    const onSelect = vi.fn();
    const tui = await renderTui(<Tabs tabs={tabs} selected={0} onSelect={onSelect} active />);
    await tui.click("History");
    await tui.click("Prompt");
    expect(onSelect.mock.calls).toEqual([[2], [1]]);
  });

  it("ignores clicks while not active", async () => {
    const onSelect = vi.fn();
    const tui = await renderTui(<Tabs tabs={tabs} selected={0} onSelect={onSelect} active={false} />);
    await tui.click("Prompt");
    expect(onSelect).not.toHaveBeenCalled();
  });
});
