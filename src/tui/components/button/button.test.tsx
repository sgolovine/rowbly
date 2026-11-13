import { Text } from "ink";
import { cleanup } from "ink-testing-library";
import { afterEach, describe, expect, it, vi } from "vitest";
import { renderTui } from "../../testing/index.js";
import { Button } from "./button.js";

afterEach(cleanup);

describe("Button", () => {
  it("shows the label and the key", async () => {
    const tui = await renderTui(<Button label="Save" keyName="ctrl+s" onClick={() => {}} clickable compact />);
    expect(tui.frame()).toContain("Save");
    expect(tui.frame()).toContain("ctrl+s");
  });

  it("calls onClick on a click while clickable", async () => {
    const onClick = vi.fn();
    const tui = await renderTui(<Button label="Save" onClick={onClick} clickable compact />);
    await tui.click("Save");
    expect(onClick).toHaveBeenCalledOnce();
  });

  it("ignores a click while not clickable", async () => {
    const onClick = vi.fn();
    const tui = await renderTui(<Button label="Save" onClick={onClick} clickable={false} compact />);
    await tui.click("Save");
    expect(onClick).not.toHaveBeenCalled();
  });

  it("shows the label of a destructive Button", async () => {
    const tui = await renderTui(
      <Button label="Delete" keyName="ctrl+d" onClick={() => {}} clickable compact destructive />,
    );
    expect(tui.frame()).toContain("Delete");
  });

  it("shows a note between the label and the key", async () => {
    const tui = await renderTui(
      <Button label="Factory" note={<Text>2/4</Text>} keyName="f" onClick={() => {}} clickable compact />,
    );
    expect(tui.frame()).toMatch(/Factory 2\/4 {2}f/);
  });
});
