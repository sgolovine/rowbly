import { cleanup } from "ink-testing-library";
import { afterEach, describe, expect, it, vi } from "vitest";
import { renderTui } from "../../../testing/index.js";
import { AiChecksPage, checkLimitsText } from "./ai-checks-page.js";

afterEach(cleanup);

const settings = {
  version: 1 as const,
  maxWorkers: 2,
  checks: { maxConcurrent: 1, items: [{ key: "test", label: "Tests", command: "pnpm test" }] },
};

describe("AiChecksPage", () => {
  it("shows the check limits and the checks, with their Buttons", async () => {
    const onLimits = vi.fn();
    const onAdd = vi.fn();
    const tui = await renderTui(
      <AiChecksPage settings={settings} idle cursor={0} onLimits={onLimits} onAdd={onAdd} onCheck={vi.fn()} />,
    );

    expect(tui.frame()).toContain("1 check at the same time · keep 2048 MB free");
    expect(tui.frame()).toMatch(/Tests \(test\)\s+full\s+pnpm test/);

    await tui.click("Edit");
    await tui.click("Add check");

    expect(onLimits).toHaveBeenCalledOnce();
    expect(onAdd).toHaveBeenCalledOnce();
  });

  it("shows no value before the settings load, and a note without checks", async () => {
    const tui = await renderTui(
      <AiChecksPage settings={undefined} idle cursor={0} onLimits={vi.fn()} onAdd={vi.fn()} onCheck={vi.fn()} />,
    );

    expect(checkLimitsText(undefined)).toBe("—");
    expect(tui.frame()).toContain("No checks. The workers run their checks in the shell.");
  });
});
