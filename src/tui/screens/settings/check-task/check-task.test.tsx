import { cleanup } from "ink-testing-library";
import { afterEach, describe, expect, it, vi } from "vitest";
import { keys, renderTui } from "../../../testing/index.js";
import { CheckTaskView, type CheckTaskViewProps } from "./check-task.js";

afterEach(cleanup);

const check = {
  key: "test",
  label: "Tests",
  command: "pnpm test",
  memoryMb: 1024,
  timeoutMinutes: 30,
  block: ["vitest"],
};

function props(overrides: Partial<CheckTaskViewProps>): CheckTaskViewProps {
  return {
    task: null,
    settings: { version: 1, maxWorkers: 2 },
    onSaveCheckLimits: vi.fn(async () => {}),
    onSaveCheck: vi.fn(async () => {}),
    onRemoveCheck: vi.fn(),
    onCancel: vi.fn(),
    ...overrides,
  };
}

describe("CheckTaskView", () => {
  it("edits the check limits with their defaults", async () => {
    const onSaveCheckLimits = vi.fn(async () => {});
    const tui = await renderTui(<CheckTaskView {...props({ task: { kind: "checkLimits" }, onSaveCheckLimits })} />);

    expect(tui.frame()).toContain("AI › Check limits");
    await tui.press(keys.ctrl("s"));

    expect(onSaveCheckLimits).toHaveBeenCalledWith({ maxConcurrent: 2, reserveMemoryMb: 2048 });
  });

  it("edits a check without its key, and asks before it removes a check", async () => {
    const onSaveCheck = vi.fn(async () => {});
    const edit = await renderTui(<CheckTaskView {...props({ task: { kind: "check", check }, onSaveCheck })} />);

    expect(edit.frame()).toContain("AI › Check › test");
    expect(edit.frame()).not.toMatch(/Key\b/);
    await edit.press(keys.ctrl("s"));
    expect(onSaveCheck).toHaveBeenCalledWith(check, expect.objectContaining({ command: "pnpm test", block: "vitest" }));
    cleanup();

    const onRemoveCheck = vi.fn();
    const remove = await renderTui(
      <CheckTaskView {...props({ task: { kind: "removeCheck", check }, onRemoveCheck })} />,
    );
    expect(remove.frame()).toContain("Remove the check test?");
    await remove.press("y");
    expect(onRemoveCheck).toHaveBeenCalledWith(check);
  });
});
