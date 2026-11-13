import { Text } from "ink";
import { cleanup } from "ink-testing-library";
import { afterEach, describe, expect, it, vi } from "vitest";
import { renderTui } from "../../testing/index.js";
import { Panel } from "./panel.js";

afterEach(cleanup);

describe("Panel", () => {
  it("sets the title into the top edge and frames the content", async () => {
    const tui = await renderTui(
      <Panel title="Backlog" width={30}>
        <Text>ROW-1</Text>
      </Panel>,
    );
    const lines = tui.frame().split("\n");
    expect(lines[0]).toBe(`╭─Backlog${"─".repeat(20)}╮`);
    expect(lines[1]).toBe(`│ ROW-1${" ".repeat(22)}│`);
    expect(lines[2]).toBe(`╰${"─".repeat(28)}╯`);
  });

  it("draws a plain top edge without a title", async () => {
    const tui = await renderTui(<Panel width={10} />);
    expect(tui.frame().split("\n")[0]).toBe(`╭${"─".repeat(8)}╮`);
  });

  it("shows breadcrumbs with ` › ` between them", async () => {
    const tui = await renderTui(<Panel title="Settings › Stages › Done" width={40} />);
    expect(tui.frame().split("\n")[0]).toMatch(/^╭─Settings › Stages › Done─+╮$/);
  });

  it("puts the aside at the right of the top edge", async () => {
    const tui = await renderTui(<Panel title="Story" width={30} aside={<Text>[x]</Text>} />);
    expect(tui.frame().split("\n")[0]).toMatch(/^╭─Story─+\[x\]╮$/);
  });

  it("calls onClick on a click inside the panel", async () => {
    const onClick = vi.fn();
    const tui = await renderTui(
      <Panel title="Backlog" width={30} onClick={onClick}>
        <Text>ROW-1</Text>
      </Panel>,
    );
    await tui.click("ROW-1");
    expect(onClick).toHaveBeenCalledOnce();
  });
});
