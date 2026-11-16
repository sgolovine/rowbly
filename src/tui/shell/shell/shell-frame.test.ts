import { describe, expect, it } from "vitest";
import { MAIN_MIN_WIDTH, STORY_SIDEBAR_MIN_WIDTH } from "../../components/index.js";
import { shellFrame } from "./shell-frame.js";
import type { ShellView } from "./shell-state.js";

function view(overrides: Partial<ShellView> = {}): ShellView {
  return {
    board: undefined,
    loading: false,
    noProject: false,
    stages: [],
    stories: [],
    mode: "stories",
    stage: undefined,
    rows: [],
    cursor: 0,
    row: undefined,
    cursorStage: undefined,
    stageIndex: 0,
    marked: new Set(),
    ranging: false,
    storyPane: { kind: "new" },
    storyActive: true,
    idle: true,
    shellKeys: false,
    sidebar: true,
    sidebarFocused: false,
    listFocused: false,
    storyFocused: true,
    ...overrides,
  };
}

const LAYOUT = { width: 200, height: 50 };
const SIDEBAR = 24;

describe("shellFrame", () => {
  it("puts the Story sidebar beside the list at its regular width", () => {
    const frame = shellFrame(LAYOUT, view(), SIDEBAR, null, false);

    expect(frame.story).toMatchObject({ mode: "beside", shown: true, cover: false, expanded: false, width: 80 });
    expect(frame.listShown).toBe(true);
    expect(frame.shownWidth).toBe(SIDEBAR);
    expect(frame.mainWidth).toBe(200 - SIDEBAR - 1 - 81 - 4);
    expect(frame.overlayWidth).toBe(200 - SIDEBAR - 1 - 4);
  });

  it("gives an expanded Story sidebar the columns of the list, and keeps the Stage sidebar", () => {
    const frame = shellFrame(LAYOUT, view(), SIDEBAR, 70, true);

    expect(frame.story).toMatchObject({ mode: "beside", shown: true, expanded: true, width: 200 - SIDEBAR - 1 });
    expect(frame.listShown).toBe(false);
    expect(frame.shownWidth).toBe(SIDEBAR);
    expect(frame.gap).toBe(1);
    expect(frame.overlayWidth).toBe(200 - SIDEBAR - 1 - 4);
    expect(frame.overlayBox).toMatchObject({ left: SIDEBAR + 1 + 2 });
  });

  it("gives an expanded Story sidebar the full width when the Stage sidebar is hidden", () => {
    const frame = shellFrame(LAYOUT, view({ sidebar: false }), SIDEBAR, null, true);

    expect(frame.story).toMatchObject({ mode: "beside", expanded: true, width: 200 });
    expect(frame.shownWidth).toBe(0);
    expect(frame.gap).toBe(0);
    expect(frame.listShown).toBe(false);
  });

  it("does not expand a Story sidebar that covers the main area of a narrow terminal", () => {
    const width = SIDEBAR + MAIN_MIN_WIDTH + STORY_SIDEBAR_MIN_WIDTH;
    const frame = shellFrame({ width, height: 50 }, view(), SIDEBAR, null, true);

    expect(frame.story).toMatchObject({ mode: "full", cover: true, expanded: false, width });
    expect(frame.listShown).toBe(false);
  });

  it("does not expand a closed Story sidebar", () => {
    const frame = shellFrame(LAYOUT, view({ storyPane: null, storyActive: false }), SIDEBAR, null, true);

    expect(frame.story).toMatchObject({ mode: "closed", shown: false, expanded: false });
    expect(frame.listShown).toBe(true);
  });
});
