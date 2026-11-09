import { cleanup } from "ink-testing-library";
import { afterEach, describe, expect, it, vi } from "vitest";
import { keys, renderTui } from "../../testing/index.js";
import { ConfirmDialog } from "./ConfirmDialog.js";

afterEach(cleanup);

function setup(props: Partial<Parameters<typeof ConfirmDialog>[0]> = {}) {
  const onConfirm = vi.fn();
  const onCancel = vi.fn();
  const tui = renderTui(<ConfirmDialog message="Delete ROW-1?" onConfirm={onConfirm} onCancel={onCancel} {...props} />);
  return { onConfirm, onCancel, tui };
}

describe("ConfirmDialog", () => {
  it("shows the message and the labels with their keys", async () => {
    const { tui } = setup({ confirmLabel: "Delete", cancelLabel: "Keep" });
    const frame = (await tui).frame();
    expect(frame).toContain("Delete ROW-1?");
    expect(frame).toContain("Delete (y)");
    expect(frame).toContain("Keep (n)");
  });

  it("confirms on y", async () => {
    const { tui, onConfirm, onCancel } = setup();
    await (await tui).press("y");
    expect(onConfirm).toHaveBeenCalledOnce();
    expect(onCancel).not.toHaveBeenCalled();
  });

  it("cancels on n and on esc", async () => {
    const { tui, onCancel } = setup();
    const t = await tui;
    await t.press("n");
    await t.press(keys.escape);
    expect(onCancel).toHaveBeenCalledTimes(2);
  });

  it("picks cancel on enter by default, and confirm after a move to it", async () => {
    const { tui, onConfirm, onCancel } = setup();
    const t = await tui;
    await t.press(keys.enter);
    expect(onCancel).toHaveBeenCalledOnce();
    await t.press(keys.left, keys.enter);
    expect(onConfirm).toHaveBeenCalledOnce();
  });

  it("takes no keys while not active", async () => {
    const { tui, onConfirm, onCancel } = setup({ isActive: false });
    await (await tui).press("y", "n");
    expect(onConfirm).not.toHaveBeenCalled();
    expect(onCancel).not.toHaveBeenCalled();
  });
});
