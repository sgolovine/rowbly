import { cleanup } from "ink-testing-library";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createToastStore, type Toast } from "../../hooks/index.js";
import { renderTui } from "../../testing/index.js";
import { ToastLine } from "./toast-line.js";

afterEach(() => {
  vi.useRealTimers();
  cleanup();
});

describe("ToastLine", () => {
  it("shows the glyph of each kind before the message", async () => {
    const glyphs = { info: "✓", warning: "!", error: "✕" } as const;
    for (const kind of ["info", "warning", "error"] as const) {
      const tui = await renderTui(<ToastLine toast={{ id: 1, kind, message: "Saved ROW-1" }} />);
      expect(tui.frame()).toContain(`  ${glyphs[kind]} Saved ROW-1`);
      tui.unmount();
    }
  });

  it("shows a spinner while pending", async () => {
    const tui = await renderTui(<ToastLine toast={{ id: 1, kind: "info", message: "Saving", pending: true }} />);
    expect(tui.frame()).toContain("⠋ Saving");
    expect(tui.frame()).not.toContain("✓");
  });

  it("dismisses itself after the time of its kind, but not while pending", async () => {
    // Only the timers ToastLine sets are fake; the helper's settle uses setTimeout too, so it runs before.
    const store = createToastStore();
    store.push("info", "Saved");
    const pendingId = store.pending("Saving");
    const [info, pending] = store.list() as Toast[];
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    const done = renderTui(
      <>
        <ToastLine toast={info as Toast} />
        <ToastLine toast={pending as Toast} />
      </>,
      { toasts: store },
    );
    await vi.advanceTimersByTimeAsync(10);
    await done;
    await vi.advanceTimersByTimeAsync(3980);
    expect(store.list().map((toast) => toast.message)).toEqual(["Saved", "Saving"]);
    await vi.advanceTimersByTimeAsync(20);
    expect(store.list().map((toast) => toast.id)).toEqual([pendingId]);
    await vi.advanceTimersByTimeAsync(10_000);
    expect(store.list().map((toast) => toast.id)).toEqual([pendingId]);
  });
});
