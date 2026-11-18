import { describe, expect, it } from "vitest";
import { shellFrame } from "./shell-frame.js";
import type { ShellHandlers } from "./shell-handlers.js";
import { stageSidebarProps, tagSidebarProps } from "./shell-props.js";
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
    tags: [{ value: "ui", label: "UI" }],
    tag: undefined,
    tagIndex: 0,
    marked: new Set(),
    ranging: false,
    storyPane: null,
    storyActive: false,
    idle: true,
    shellKeys: false,
    sidebar: true,
    sidebarFocused: false,
    tagSidebar: true,
    tagSidebarFocused: false,
    listFocused: true,
    storyFocused: false,
    ...overrides,
  };
}

const resizeStages = (_width: number): void => undefined;
const resizeTags = (_height: number): void => undefined;
const handlers = { resizeStages, resizeTags } as unknown as ShellHandlers;
const parts = { entries: [], button: undefined };
const SIDEBAR = 24;

describe("tagSidebarProps", () => {
  it("drags the width of the two sidebars with the handler of the Stage sidebar beside the list", () => {
    const shell = view();
    const frame = shellFrame({ width: 200, height: 50 }, shell, SIDEBAR);
    const tags = tagSidebarProps(handlers, shell, frame, parts);
    const stages = stageSidebarProps(handlers, shell, frame, parts);

    expect(frame.stacked).toBe(false);
    expect(tags?.onResize).toBe(resizeStages);
    expect(stages.onResize).toBe(resizeStages);
    expect(tags?.width).toBe(stages.width);
    expect(tags?.maxWidth).toBe(stages.maxWidth);
  });

  it("does not drag the width when the sidebars are stacked", () => {
    const shell = view();
    const frame = shellFrame({ width: 80, height: 50 }, shell, SIDEBAR);
    const tags = tagSidebarProps(handlers, shell, frame, parts);

    expect(frame.stacked).toBe(true);
    expect(tags?.onResize).toBeUndefined();
  });

  it("does not show without tags", () => {
    const shell = view({ tags: [], tagSidebar: false });
    const frame = shellFrame({ width: 200, height: 50 }, shell, SIDEBAR);

    expect(tagSidebarProps(handlers, shell, frame, parts)).toBeUndefined();
  });
});
