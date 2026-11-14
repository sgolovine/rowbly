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
});
