import { cleanup } from "ink-testing-library";
import { afterEach, describe, expect, it, vi } from "vitest";
import { keys, renderTui } from "../../testing/index.js";
import { ConfirmDialog } from "./confirm-dialog.js";

afterEach(cleanup);

function setup(props: Partial<Parameters<typeof ConfirmDialog>[0]> = {}) {
  const onConfirm = vi.fn();
  const onCancel = vi.fn();
  const tui = renderTui(
    <ConfirmDialog title="Remove Story" message="Drop ROW-1?" onConfirm={onConfirm} onCancel={onCancel} {...props} />,
  );
  return { onConfirm, onCancel, tui };
}

describe("ConfirmDialog", () => {
  it("shows the title, the message, the labels with their keys and `esc cancel`", async () => {
    const { tui } = setup({ confirmLabel: "Delete", cancelLabel: "Keep" });
    const frame = (await tui).frame();
    expect(frame).toContain("Remove Story");
    expect(frame).toContain("Drop ROW-1?");
    expect(frame).toMatch(/Delete {2}y /);
    expect(frame).toMatch(/Keep {2}n /);
    expect(frame).toContain("esc cancel");
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

  it("confirms on a click on the confirm button", async () => {
    const { tui, onConfirm, onCancel } = setup();
    await (await tui).click("Yes");
    expect(onConfirm).toHaveBeenCalledOnce();
    expect(onCancel).not.toHaveBeenCalled();
  });

  it("cancels on a click on the cancel button", async () => {
    const { tui, onConfirm, onCancel } = setup();
    await (await tui).click("No");
    expect(onCancel).toHaveBeenCalledOnce();
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it("confirms once on a double click", async () => {
    const { tui, onConfirm } = setup();
    const t = await tui;
    await t.click("Yes");
    await t.click("Yes");
    expect(onConfirm).toHaveBeenCalledOnce();
  });

  it("takes no keys or clicks while not active", async () => {
    const { tui, onConfirm, onCancel } = setup({ isActive: false });
    const t = await tui;
    await t.press("y", "n");
    await t.click("Yes");
    await t.click("No");
    expect(onConfirm).not.toHaveBeenCalled();
    expect(onCancel).not.toHaveBeenCalled();
  });
});
