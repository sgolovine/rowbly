import { describe, expect, it } from "vitest";
import { MAIN_MIN_WIDTH, SIDEBAR_CHROME_HEIGHT, STORY_SIDEBAR_MIN_WIDTH } from "../../components/index.js";
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
    tags: [],
    tag: undefined,
    tagIndex: 0,
    marked: new Set(),
    ranging: false,
    storyPane: { kind: "new" },
    storyActive: true,
    idle: true,
    shellKeys: false,
    sidebar: true,
    sidebarFocused: false,
    tagSidebar: false,
    tagSidebarFocused: false,
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

  it("gives the Stage sidebar all rows when the tag sidebar does not show", () => {
    const frame = shellFrame(LAYOUT, view({ storyPane: null, storyActive: false }), SIDEBAR);

    expect(frame.stagesHeight).toBe(frame.mainHeight);
    expect(frame.tagsHeight).toBe(0);
  });

  it("puts the tag sidebar below the Stage sidebar and fits its entries", () => {
    const tags = [
      { value: "a", label: "A" },
      { value: "b", label: "B" },
    ];
    const frame = shellFrame(LAYOUT, view({ storyPane: null, storyActive: false, tags, tagSidebar: true }), SIDEBAR);

    expect(frame.tagsHeight).toBe(tags.length + 1 + 3);
    expect(frame.stagesHeight).toBe((frame.mainHeight ?? 0) - (frame.tagsHeight ?? 0));
  });

  it("gives the tag sidebar at most half of the rows beside the list", () => {
    const tags = Array.from({ length: 60 }, (_, i) => ({ value: `t${i}`, label: `T${i}` }));
    const frame = shellFrame(LAYOUT, view({ storyPane: null, storyActive: false, tags, tagSidebar: true }), SIDEBAR);
    const main = frame.mainHeight ?? 0;

    expect(frame.tagsHeight).toBe(Math.floor(main / 2));
    expect(frame.stagesHeight).toBe(main - Math.floor(main / 2));
  });

  it("stacks both sidebars above the list and keeps half of the main area for the list", () => {
    const tags = Array.from({ length: 30 }, (_, i) => ({ value: `t${i}`, label: `T${i}` }));
    const stages = Array.from({ length: 10 }, () => ({}) as ShellView["stages"][number]);
    const frame = shellFrame(
      { width: 80, height: 50 },
      view({ storyPane: null, storyActive: false, stages, tags, tagSidebar: true }),
      SIDEBAR,
    );
    const main = frame.mainHeight ?? 0;

    expect(frame.stacked).toBe(true);
    expect(frame.stackedHeight).toBe(Math.floor(main / 2));
    expect((frame.stagesHeight ?? 0) + (frame.tagsHeight ?? 0)).toBe(frame.stackedHeight);
    expect(frame.listHeight).toBeGreaterThanOrEqual(Math.ceil(main / 2));
  });

  it("stacks a short tag sidebar with all its entries", () => {
    const tags = [{ value: "a", label: "A" }];
    const frame = shellFrame(
      { width: 80, height: 50 },
      view({ storyPane: null, storyActive: false, tags, tagSidebar: true }),
      SIDEBAR,
    );

    expect(frame.stackedHeight).toBe(1 + 3 + 2 + 3);
    expect(frame.tagsHeight).toBe(2 + 3);
    expect(frame.stagesHeight).toBe(1 + 3);
  });

  describe("with a dragged tag sidebar height", () => {
    const tags = [
      { value: "a", label: "A" },
      { value: "b", label: "B" },
    ];
    const tagView = view({ storyPane: null, storyActive: false, tags, tagSidebar: true });
    const least = SIDEBAR_CHROME_HEIGHT + 1;

    it("gives the same frame as before without a dragged height", () => {
      expect(shellFrame(LAYOUT, tagView, SIDEBAR, null, false, null)).toEqual(shellFrame(LAYOUT, tagView, SIDEBAR));
    });

    it("uses the dragged height beside the list, and gives the other rows to the Stage sidebar", () => {
      const frame = shellFrame(LAYOUT, tagView, SIDEBAR, null, false, 20);

      expect(frame.tagsHeight).toBe(20);
      expect((frame.stagesHeight ?? 0) + (frame.tagsHeight ?? 0)).toBe(frame.mainHeight);
      expect(frame.tagsRoom).toBe((frame.mainHeight ?? 0) - least);
    });

    it("keeps the smallest height of the tag sidebar", () => {
      const frame = shellFrame(LAYOUT, tagView, SIDEBAR, null, false, 1);

      expect(frame.tagsHeight).toBe(least);
      expect((frame.stagesHeight ?? 0) + (frame.tagsHeight ?? 0)).toBe(frame.mainHeight);
    });

    it("keeps the smallest height of the Stage sidebar", () => {
      const frame = shellFrame(LAYOUT, tagView, SIDEBAR, null, false, 500);

      expect(frame.stagesHeight).toBe(least);
      expect(frame.tagsHeight).toBe((frame.mainHeight ?? 0) - least);
    });

    it("ignores the dragged height when the sidebars are stacked", () => {
      const narrow = { width: 80, height: 50 };
      const frame = shellFrame(narrow, tagView, SIDEBAR, null, false, 20);

      expect(frame.stacked).toBe(true);
      expect(frame).toEqual(shellFrame(narrow, tagView, SIDEBAR));
      expect(frame.tagsHeight).toBe(tags.length + 1 + 3);
      expect(frame.tagsRoom).toBe(0);
    });
  });
});
