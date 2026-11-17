import { describe, expect, it } from "vitest";
import { shellHints } from "./shell-hints.js";
import type { Board, ShellView } from "./shell-state.js";

function view(overrides: Partial<ShellView> = {}): ShellView {
  return {
    board: {} as Board,
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
    tags: [{ value: "a", label: "A" }],
    tag: undefined,
    tagIndex: 0,
    marked: new Set(),
    ranging: false,
    storyPane: null,
    storyActive: false,
    idle: true,
    shellKeys: true,
    sidebar: true,
    sidebarFocused: false,
    tagSidebar: true,
    tagSidebarFocused: true,
    listFocused: false,
    storyFocused: false,
    ...overrides,
  };
}

describe("shellHints", () => {
  it("shows the n key of a new tag while the tag sidebar has the focus", () => {
    expect(shellHints(view(), true, [])).toContainEqual({ key: "n", description: "new tag" });
  });

  it("shows the n key of a new Stage while the Stage sidebar has the focus", () => {
    const hints = shellHints(view({ sidebarFocused: true, tagSidebarFocused: false }), true, []);

    expect(hints).toContainEqual({ key: "n", description: "new Stage" });
    expect(hints).not.toContainEqual({ key: "n", description: "new tag" });
  });
});
