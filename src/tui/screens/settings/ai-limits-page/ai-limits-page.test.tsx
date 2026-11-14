import { cleanup } from "ink-testing-library";
import { afterEach, describe, expect, it, vi } from "vitest";
import { renderTui } from "../../../testing/index.js";
import { AiLimitsPage } from "./ai-limits-page.js";

afterEach(cleanup);

describe("AiLimitsPage", () => {
  it("shows the worker limit with its Edit Button", async () => {
    const onLimit = vi.fn();
    const tui = await renderTui(<AiLimitsPage settings={{ maxWorkers: 1 }} idle onLimit={onLimit} />);

    expect(tui.frame()).toMatch(/Worker limit\s+Edit\s+l/);
    expect(tui.frame()).toContain("1 worker");

    await tui.click("Edit");

    expect(onLimit).toHaveBeenCalledOnce();
  });

  it("shows no value before the settings load", async () => {
    const tui = await renderTui(<AiLimitsPage settings={undefined} idle onLimit={vi.fn()} />);

    expect(tui.frame()).toContain("—");
  });
});
