import { Text } from "ink";
import { cleanup } from "ink-testing-library";
import { afterEach, describe, expect, it, vi } from "vitest";
import { renderTui } from "../../../testing/index.js";
import { FactoryList } from "./factory-list.js";

afterEach(cleanup);

const rows = (count: number) => Array.from({ length: count }, (_, i) => ({ key: `r${i}`, node: <Text>row {i}</Text> }));

describe("FactoryList", () => {
  it("shows nothing without rows", async () => {
    const tui = await renderTui(<FactoryList title="Queue" rows={[]} />);

    expect(tui.frame()).not.toContain("Queue");
  });

  it("shows the title and five rows, then the number of the other rows", async () => {
    const tui = await renderTui(<FactoryList title="Queue" rows={rows(7)} />);

    expect(tui.frame()).toContain("Queue");
    expect(tui.frame()).toContain("row 4");
    expect(tui.frame()).not.toContain("row 5");
    expect(tui.frame()).toContain("↓ 2 more");
  });

  it("runs the action of a row on a click only while it is clickable", async () => {
    const onClick = vi.fn();
    const row = [{ key: "a", node: <Text>row a</Text>, onClick }];
    const tui = await renderTui(<FactoryList title="Attention" rows={row} />);

    await tui.click("row a");

    expect(onClick).not.toHaveBeenCalled();

    await tui.rerender(<FactoryList title="Attention" rows={row} clickable />);
    await tui.click("row a");

    expect(onClick).toHaveBeenCalledOnce();
  });
});
