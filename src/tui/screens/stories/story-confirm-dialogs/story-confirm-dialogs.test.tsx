import { cleanup } from "ink-testing-library";
import { afterEach, describe, expect, it, vi } from "vitest";
import { renderTui } from "../../../testing/index.js";
import { StoryConfirmDialogs } from "./story-confirm-dialogs.js";

afterEach(cleanup);

describe("StoryConfirmDialogs", () => {
  it("closes the confirmation, then deletes the Story", async () => {
    const order: string[] = [];
    const tui = await renderTui(
      <StoryConfirmDialogs
        confirming="delete"
        onDelete={{ title: "Delete Story", message: "Delete it?", onConfirm: () => order.push("delete") }}
        onConfirming={(confirm) => order.push(`confirming:${confirm}`)}
      />,
    );
    expect(tui.frame()).toContain("Delete it?");
    await tui.press("y");
    expect(order).toEqual(["confirming:null", "delete"]);
  });

  it("closes the confirmation without a delete when the user cancels", async () => {
    const onConfirm = vi.fn();
    const onConfirming = vi.fn();
    const tui = await renderTui(
      <StoryConfirmDialogs
        confirming="delete"
        onDelete={{ title: "Delete Story", message: "Delete it?", onConfirm }}
        onConfirming={onConfirming}
      />,
    );
    await tui.press("n");
    expect(onConfirming).toHaveBeenCalledWith(null);
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it("shows nothing without a confirmation", async () => {
    const tui = await renderTui(
      <StoryConfirmDialogs
        confirming={null}
        onDelete={{ title: "Delete Story", message: "Delete it?", onConfirm: vi.fn() }}
        onConfirming={vi.fn()}
      />,
    );
    expect(tui.frame().trim()).toBe("");
  });
});
