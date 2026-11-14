import { cleanup } from "ink-testing-library";
import { afterEach, describe, expect, it, vi } from "vitest";
import { renderTui } from "../../../testing/index.js";
import { AiSettingCard, type AiSettingCardProps } from "./ai-setting-card.js";

afterEach(cleanup);

function props(overrides: Partial<AiSettingCardProps> = {}): AiSettingCardProps {
  return {
    title: "Worker limit",
    value: "4 workers",
    description: "The maximum number of workers.",
    action: "Edit",
    keyName: "l",
    clickable: true,
    onEdit: vi.fn(),
    ...overrides,
  };
}

describe("AiSettingCard", () => {
  it("shows the name, the edit Button with its key, the value and the description", async () => {
    const p = props();
    const tui = await renderTui(<AiSettingCard {...p} />);

    expect(tui.frame()).toMatch(/Worker limit\s+Edit\s+l/);
    expect(tui.frame()).toContain("4 workers");
    expect(tui.frame()).toContain("The maximum number of workers.");

    await tui.click("Edit");

    expect(p.onEdit).toHaveBeenCalledOnce();
  });

  it("has no Button without an action", async () => {
    const tui = await renderTui(<AiSettingCard {...props({ action: undefined })} />);

    expect(tui.frame()).not.toContain("Edit");
  });
});
