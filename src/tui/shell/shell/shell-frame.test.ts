import { describe, expect, it } from "vitest";
import {
  FOOTER_HEIGHT,
  HEADER_HEIGHT,
  MAIN_MIN_WIDTH,
  SIDEBAR_MIN_WIDTH,
  SIDEBAR_WIDTH,
  STACKED_BELOW_WIDTH,
  STORY_SIDEBAR_MIN_WIDTH,
} from "../../components/index.js";
import { shellFrame } from "./shell-frame.js";
import type { ShellView } from "./shell-state.js";

function view(change: Partial<ShellView> = {}): ShellView {
  return {
    sidebar: true,
    stages: [],
    board: undefined,
    storyPane: null,
    storyActive: false,
    ...change,
  } as unknown as ShellView;
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

describe("shellFrame with the Story sidebar", () => {
  const open = { kind: "new" } as const;

  it("puts the Story sidebar beside the list at 40% of the width, and makes the list narrower", () => {
    const frame = shellFrame({ width: 150, height: 40 }, view({ storyPane: open }), SIDEBAR_WIDTH);

    expect(frame.story).toMatchObject({ mode: "beside", shown: true, cover: false, width: 60, height: 36 });
    expect(frame.mainWidth).toBe(150 - SIDEBAR_WIDTH - 1 - 61 - 4);
    // The Modals are centred over the list and the Story sidebar.
    expect(frame.overlayWidth).toBe(frame.mainWidth + 61);
    expect(frame.overlayBox).toMatchObject({ left: SIDEBAR_WIDTH + 3, width: frame.overlayWidth });
    expect(frame.story.room).toBe(150 - SIDEBAR_WIDTH - 1 - MAIN_MIN_WIDTH - 1);
  });

  it("keeps the dragged width between STORY_SIDEBAR_MIN_WIDTH and the room that leaves MAIN_MIN_WIDTH to the list", () => {
    const layout = { width: 150, height: 40 };
    const narrow = shellFrame(layout, view({ storyPane: open }), SIDEBAR_WIDTH, 10);
    const wide = shellFrame(layout, view({ storyPane: open }), SIDEBAR_WIDTH, 500);
    const dragged = shellFrame(layout, view({ storyPane: open }), SIDEBAR_WIDTH, 70);

    expect(narrow.story.width).toBe(STORY_SIDEBAR_MIN_WIDTH);
    expect(wide.story.width).toBe(wide.story.room);
    expect(wide.mainWidth + 4).toBe(MAIN_MIN_WIDTH);
    expect(dragged.story.width).toBe(70);
  });

  it("keeps room for the Story sidebar when the Stage sidebar is dragged wide", () => {
    const frame = shellFrame({ width: 120, height: 40 }, view({ storyPane: open }), 200);

    expect(frame.story.mode).toBe("beside");
    expect(frame.story.width).toBeGreaterThanOrEqual(STORY_SIDEBAR_MIN_WIDTH);
    expect(frame.shownWidth + 1 + frame.mainWidth + 4 + 1 + frame.story.width).toBe(120);
  });

  it("gives the full main area to the Story sidebar in a terminal narrower than STACKED_BELOW_WIDTH", () => {
    const layout = { width: STACKED_BELOW_WIDTH - 1, height: 40 };
    const active = shellFrame(layout, view({ storyPane: open, storyActive: true }), SIDEBAR_WIDTH);
    const behind = shellFrame(layout, view({ storyPane: open, storyActive: false }), SIDEBAR_WIDTH);

    expect(active.story).toMatchObject({ mode: "full", shown: true, cover: true, width: layout.width });
    expect([active.shownWidth, active.gap]).toEqual([0, 0]);
    expect(behind.story).toMatchObject({ mode: "full", shown: false, cover: false });
    expect(behind.mainWidth).toBe(layout.width - 4);
  });

  it("sizes a Thread in the sidebar as a Story: beside the list, or on the full main area of a narrow terminal", () => {
    const thread = { kind: "thread", thread: { id: "t1" } } as const;
    const narrow = { width: STACKED_BELOW_WIDTH - 1, height: 40 };
    const full = shellFrame(narrow, view({ storyPane: thread, storyActive: true } as never), SIDEBAR_WIDTH);
    const beside = shellFrame({ width: 150, height: 40 }, view({ storyPane: thread } as never), SIDEBAR_WIDTH, 50);

    expect(full.story).toMatchObject({ mode: "full", shown: true, cover: true, width: narrow.width });
    expect(beside.story).toMatchObject({ mode: "beside", shown: true, width: 50 });
  });

  it("puts the Story sidebar beside the list from STACKED_BELOW_WIDTH, where the narrowest panes all fit", () => {
    const layout = { width: STACKED_BELOW_WIDTH, height: 40 };
    const frame = shellFrame(layout, view({ storyPane: open }), SIDEBAR_WIDTH);

    expect(STACKED_BELOW_WIDTH).toBeGreaterThanOrEqual(
      SIDEBAR_MIN_WIDTH + MAIN_MIN_WIDTH + STORY_SIDEBAR_MIN_WIDTH + 2,
    );
    expect(frame.story).toMatchObject({ mode: "beside", width: STORY_SIDEBAR_MIN_WIDTH });
    expect(frame.shownWidth + 1 + frame.mainWidth + 4 + 1 + frame.story.width).toBe(layout.width);
  });

  it("has no Story sidebar when it is closed", () => {
    const frame = shellFrame({ width: 150, height: 40 }, view(), SIDEBAR_WIDTH);

    expect(frame.story).toMatchObject({ mode: "closed", shown: false });
    expect(frame.mainWidth).toBe(150 - SIDEBAR_WIDTH - 1 - 4);
  });
});
