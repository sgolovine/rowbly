import { describe, expect, it } from "vitest";
import { FOOTER_HEIGHT, HEADER_HEIGHT, SIDEBAR_WIDTH } from "../../components/index.js";
import { shellFrame } from "./shell-frame.js";
import type { ShellView } from "./shell-state.js";

function view(change: Partial<ShellView> = {}): ShellView {
  return { sidebar: true, stages: [], board: undefined, ...change } as unknown as ShellView;
}

describe("shellFrame", () => {
  it("puts the sidebar beside the list in a wide terminal", () => {
    const frame = shellFrame({ width: 120, height: 40 }, view(), SIDEBAR_WIDTH);

    expect(frame.stacked).toBe(false);
    expect(frame.gap).toBe(1);
    expect(frame.shownWidth).toBe(SIDEBAR_WIDTH);
    expect(frame.mainHeight).toBe(40 - HEADER_HEIGHT - FOOTER_HEIGHT);
    expect(frame.mainWidth).toBe(120 - SIDEBAR_WIDTH - 1 - 4);
    expect(frame.overlayBox).toMatchObject({ position: "absolute", top: 1, left: SIDEBAR_WIDTH + 3 });
  });

  it("puts the sidebar above the list in a narrow terminal", () => {
    const frame = shellFrame({ width: 50, height: 40 }, view(), SIDEBAR_WIDTH);

    expect(frame.stacked).toBe(true);
    expect([frame.gap, frame.shownWidth]).toEqual([0, 0]);
    expect(frame.stackedHeight).toBeGreaterThan(0);
    expect(frame.listHeight).toBe((frame.mainHeight ?? 0) - frame.stackedHeight);
  });

  it("has no heights when the app grows with its content", () => {
    const frame = shellFrame({ width: 100 }, view({ sidebar: false }), SIDEBAR_WIDTH);

    expect([frame.mainHeight, frame.listHeight, frame.overlayHeight]).toEqual([undefined, undefined, undefined]);
    expect(frame.overlayBox).toEqual({});
    expect(frame.mainWidth).toBe(96);
  });

  it("keeps one line below the list for a problem with the factory state file", () => {
    const ok = shellFrame({ width: 120, height: 40 }, view({ board: { activity: { status: "ok" } } } as never), 20);
    const bad = shellFrame(
      { width: 120, height: 40 },
      view({ board: { activity: { status: "incomplete" } } } as never),
      20,
    );

    expect(ok.statusLine).toBe(false);
    expect(bad.statusLine).toBe(true);
    expect(bad.listInnerHeight).toBe((ok.listInnerHeight ?? 0) - 1);
  });
});
