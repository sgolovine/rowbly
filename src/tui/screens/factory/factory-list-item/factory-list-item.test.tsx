import { Text } from "ink";
import { cleanup } from "ink-testing-library";
import { afterEach, describe, expect, it, vi } from "vitest";
import { renderTui } from "../../../testing/index.js";
import { FactoryListItem } from "./factory-list-item.js";

afterEach(cleanup);

describe("FactoryListItem", () => {
  it("shows its row and runs onClick on a click while it is clickable", async () => {
    const onClick = vi.fn();
    const tui = await renderTui(
      <FactoryListItem onClick={onClick} clickable>
        <Text>the row</Text>
      </FactoryListItem>,
    );

    expect(tui.frame()).toContain("the row");

    await tui.click("the row");

    expect(onClick).toHaveBeenCalledOnce();
  });

  it("takes no click while it is not clickable", async () => {
    const onClick = vi.fn();
    const tui = await renderTui(
      <FactoryListItem onClick={onClick} clickable={false}>
        <Text>the row</Text>
      </FactoryListItem>,
    );

    await tui.click("the row");

    expect(onClick).not.toHaveBeenCalled();
  });

  it("shows the selection bar of a selected row and runs onClick on a click", async () => {
    const onClick = vi.fn();
    const tui = await renderTui(
      <FactoryListItem onClick={onClick} clickable selected>
        <Text>the row</Text>
      </FactoryListItem>,
    );

    expect(tui.frame()).toContain("▌ the row");

    await tui.click("the row");

    expect(onClick).toHaveBeenCalledOnce();
  });

  it("keeps the bar column empty for a row that is not selected", async () => {
    const tui = await renderTui(
      <FactoryListItem onClick={vi.fn()} clickable selected={false}>
        <Text>the row</Text>
      </FactoryListItem>,
    );

    expect(tui.frame()).toContain("  the row");
    expect(tui.frame()).not.toContain("▌");
  });

  it("takes no click on a selectable row while it is not clickable", async () => {
    const onClick = vi.fn();
    const tui = await renderTui(
      <FactoryListItem onClick={onClick} clickable={false} selected>
        <Text>the row</Text>
      </FactoryListItem>,
    );

    await tui.click("the row");

    expect(onClick).not.toHaveBeenCalled();
  });
});
