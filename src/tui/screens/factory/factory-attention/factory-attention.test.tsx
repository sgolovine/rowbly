import { cleanup } from "ink-testing-library";
import { afterEach, describe, expect, it, vi } from "vitest";
import { keys, renderTui } from "../../../testing/index.js";
import type { FactoryProblem } from "../factory-status.js";
import { FactoryAttention } from "./factory-attention.js";

afterEach(cleanup);

const problems: FactoryProblem[] = Array.from({ length: 7 }, (_, i) => ({
  key: `attention:k${i}`,
  kind: "attention",
  title: `k${i}`,
  text: `Warning number ${i}`,
  message: `Warning number ${i}`,
  attentionKey: `k${i}`,
  dismissible: true,
}));

describe("FactoryAttention", () => {
  it("lists all warnings, not only five, and picks the highlighted one with enter", async () => {
    const onPick = vi.fn();
    const tui = await renderTui(
      <FactoryAttention problems={problems} height={30} active onFilteringChange={vi.fn()} onPick={onPick} />,
    );

    expect(tui.frame()).toContain("Warning number 0");
    expect(tui.frame()).toContain("Warning number 6");

    await tui.press(keys.down);
    await tui.press(keys.enter);

    expect(onPick).toHaveBeenCalledWith("attention:k1");
  });

  it("cuts a long warning to one row", async () => {
    const long = { ...problems[0], text: "x".repeat(200) } as FactoryProblem;
    const tui = await renderTui(
      <FactoryAttention problems={[long]} height={30} active onFilteringChange={vi.fn()} onPick={vi.fn()} />,
    );

    expect(tui.frame()).toContain("…");
    expect(tui.frame()).not.toContain("x".repeat(64));
  });

  it("opens a warning with a click", async () => {
    const onPick = vi.fn();
    const tui = await renderTui(
      <FactoryAttention problems={problems} height={30} active onFilteringChange={vi.fn()} onPick={onPick} />,
    );

    await tui.click("Warning number 3");

    expect(onPick).toHaveBeenCalledWith("attention:k3");
  });
});
