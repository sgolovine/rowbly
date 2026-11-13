import { Box } from "ink";
import { cleanup } from "ink-testing-library";
import { afterEach, describe, expect, it } from "vitest";
import { renderTui, settle } from "../../testing/index.js";
import { ToastArea } from "./toast-area.js";

afterEach(cleanup);

// The area is absolute: a box with a height gives it rows in the frame, as the full screen does.
const area = (
  <Box height={16} width={100}>
    <ToastArea />
  </Box>
);

describe("ToastArea", () => {
  it("draws nothing without toasts", async () => {
    const tui = await renderTui(area);
    expect(tui.frame().trim()).toBe("");
  });

  it("shows the toasts of the store, the newest at the bottom", async () => {
    const tui = await renderTui(area);
    tui.toasts.push("info", "Saved ROW-1");
    tui.toasts.push("error", "Not found");
    await settle();
    const frame = tui.frame();
    expect(frame).toContain("✓ Saved ROW-1");
    expect(frame).toContain("✕ Not found");
    expect(frame.indexOf("Saved ROW-1")).toBeLessThan(frame.indexOf("Not found"));
  });

  it("shows at most three toasts and drops a dismissed one", async () => {
    const tui = await renderTui(area);
    for (const n of [1, 2, 3, 4]) tui.toasts.push("info", `Toast ${n}`);
    await settle();
    expect(tui.frame()).not.toContain("Toast 1");
    expect(tui.frame()).toContain("Toast 4");
    tui.toasts.dismiss(tui.toasts.list()[0]?.id ?? 0);
    await settle();
    expect(tui.frame()).not.toContain("Toast 2");
    expect(tui.frame()).toContain("Toast 3");
  });
});
