import { describe, expect, it } from "vitest";
import type { Project } from "../../../services/project/project.js";
import type { Stage } from "../../../services/stage/stage.js";
import type { Story } from "../../../services/story/story.js";
import type { Board } from "./shell-state.js";
import { shellRows, shellView } from "./shell-view.js";

function story(id: string, stage: string, tags: string[]): Story {
  return { id, stage, tags, title: id, dependsOn: [] } as unknown as Story;
}

const STAGES = [
  { key: "TODO", label: "To do" },
  { key: "DONE", label: "Done" },
] as unknown as Stage[];

const STORIES = [story("ROW-1", "TODO", ["ui"]), story("ROW-2", "TODO", []), story("ROW-3", "DONE", ["ui", "api"])];

function board(
  tags = [
    { value: "ui", label: "UI" },
    { value: "api", label: "API" },
  ],
): Board {
  return {
    project: { tags, projectName: "Demo", root: "/demo" } as unknown as Project,
    stages: STAGES,
    stories: STORIES,
    activity: { status: "ok", stories: {} } as unknown as Board["activity"],
  };
}

function storyIds(rows: ReturnType<typeof shellRows>): string[] {
  return rows.flatMap((row) => (row.kind === "story" ? [row.id] : []));
}

function viewOf(
  b: Board,
  input: { tagKey?: string | null; pane?: "stages" | "tags" | "stories"; sidebarShown?: boolean },
) {
  const tagKey = input.tagKey ?? null;

  return shellView({
    data: { loading: false, data: b },
    active: true,
    overlay: null,
    pane: input.pane ?? "stories",
    storyPane: null,
    mode: "stories",
    sidebarShown: input.sidebarShown ?? true,
    stageKey: null,
    tagKey,
    selectedId: null,
    collapsed: new Set(),
    marked: new Set(),
    anchor: null,
    rows: shellRows(b, null, tagKey, new Set()),
  });
}

describe("shellRows", () => {
  it("shows every Story without a tag filter", () => {
    expect(storyIds(shellRows(board(), null, null, new Set()))).toEqual(["ROW-1", "ROW-2", "ROW-3"]);
  });

  it("shows only the Stories with the tag of the filter", () => {
    expect(storyIds(shellRows(board(), null, "ui", new Set()))).toEqual(["ROW-1", "ROW-3"]);
  });

  it("combines the tag filter with the Stage filter", () => {
    expect(storyIds(shellRows(board(), "TODO", "ui", new Set()))).toEqual(["ROW-1"]);
    expect(storyIds(shellRows(board(), "TODO", "api", new Set()))).toEqual([]);
  });

  it("does not filter with a tag that is not in the config", () => {
    expect(storyIds(shellRows(board([{ value: "api", label: "API" }]), null, "ui", new Set()))).toEqual([
      "ROW-1",
      "ROW-2",
      "ROW-3",
    ]);
  });
});

describe("shellView", () => {
  it("gives the tags, the selected tag and its sidebar entry", () => {
    const view = viewOf(board(), { tagKey: "api" });

    expect(view.tags.map((t) => t.value)).toEqual(["ui", "api"]);
    expect(view.tag?.label).toBe("API");
    expect(view.tagIndex).toBe(2);
    expect(view.tagSidebar).toBe(true);
  });

  it("acts as All Tags when the tag of the filter is gone", () => {
    const view = viewOf(board([{ value: "ui", label: "UI" }]), { tagKey: "api" });

    expect(view.tag).toBeUndefined();
    expect(view.tagIndex).toBe(0);
  });

  it("gives the focus to the tag sidebar, and not to the list", () => {
    const view = viewOf(board(), { pane: "tags" });

    expect(view.tagSidebarFocused).toBe(true);
    expect(view.listFocused).toBe(false);
    expect(view.sidebarFocused).toBe(false);
  });

  it("hides the tag sidebar without tags, and the list gets the focus", () => {
    const view = viewOf(board([]), { pane: "tags" });

    expect(view.tagSidebar).toBe(false);
    expect(view.tagSidebarFocused).toBe(false);
    expect(view.listFocused).toBe(true);
  });

  it("hides the tag sidebar with the Stage sidebar", () => {
    expect(viewOf(board(), { sidebarShown: false }).tagSidebar).toBe(false);
  });
});
