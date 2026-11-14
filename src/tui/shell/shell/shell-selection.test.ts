import { describe, expect, it, vi } from "vitest";
import type { Project } from "../../../services/project/project.js";
import type { Stage } from "../../../services/stage/stage.js";
import type { Story } from "../../../services/story/story.js";
import { createShellRegistry, createToastStore } from "../../hooks/index.js";
import {
  clickRow,
  fold,
  openFoundStory,
  showSavedStage,
  showSavedStory,
  switchProject,
  toggleSidebar,
} from "./shell-selection.js";
import type { Board, ShellEnv } from "./shell-state.js";
import { type ShellViewInput, shellView } from "./shell-view.js";

const STORY = { id: "ROW-01", number: 1, title: "One", stage: "BACKLOG", position: 1 } as Story;
const BOARD: Board = {
  project: { root: "/p", projectName: "Rowbly" } as Project,
  stages: [{ key: "BACKLOG", label: "Backlog" } as Stage, { key: "DONE", label: "Done" } as Stage],
  stories: [STORY],
  activity: { path: "", status: "ok", stories: {} },
};

function env(change: Partial<ShellViewInput> = {}, sidebarShown = true): ShellEnv {
  const view = shellView({
    data: { loading: false, data: BOARD },
    active: true,
    overlay: null,
    pane: "stories",
    storyPane: null,
    sidebarShown,
    stageKey: null,
    selectedId: null,
    collapsed: new Set(),
    ...change,
  });

  return {
    ctx: { home: "/home" },
    view,
    stageKey: change.stageKey ?? null,
    sidebarShown,
    registry: createShellRegistry(),
    toast: createToastStore(),
    exit: vi.fn(),
    reload: vi.fn(),
    setCtx: vi.fn(),
    setOverlay: vi.fn(),
    setOnboardingHints: vi.fn(),
    setPane: vi.fn(),
    setSidebarWidth: vi.fn(),
    setSidebarShown: vi.fn(),
    setStoryPane: vi.fn(),
    setStoryWidth: vi.fn(),
    setStoryHints: vi.fn(),
    setStageKey: vi.fn(),
    setSelectedId: vi.fn(),
    setCollapsed: vi.fn(),
  };
}

/** The value that the last call of `setCollapsed` gives for `current`. */
function collapsedAfter(shell: ShellEnv, current: ReadonlySet<string>): ReadonlySet<string> {
  const update = vi.mocked(shell.setCollapsed).mock.lastCall?.[0];

  return typeof update === "function" ? update(current) : (update ?? current);
}

describe("shell selection", () => {
  it("collapses and expands a section without a change to the earlier set", () => {
    const shell = env();
    const before = new Set(["DONE"]);

    fold(shell, "BACKLOG", true);
    expect([...collapsedAfter(shell, before)]).toEqual(["DONE", "BACKLOG"]);
    fold(shell, "DONE", false);
    expect([...collapsedAfter(shell, before)]).toEqual([]);
    expect([...before]).toEqual(["DONE"]);
  });

  it("shows a saved Story: it leaves a Stage filter that hides the Story", () => {
    const shell = env({ stageKey: "DONE" });

    showSavedStory(shell, STORY);

    expect(shell.setStageKey).toHaveBeenCalledWith(null);
    expect(shell.setSelectedId).toHaveBeenCalledWith("ROW-01");
    expect(shell.setStoryPane).toHaveBeenCalledWith(null);
    expect(shell.reload).toHaveBeenCalledOnce();
  });

  it("expands a heading, and opens a Story, on a click", () => {
    const shell = env();

    clickRow(shell, 0);
    clickRow(shell, 1);

    expect(shell.setPane).toHaveBeenCalledWith("stories");
    expect(shell.setCollapsed).toHaveBeenCalledOnce();
    expect(shell.setStoryPane).toHaveBeenCalledWith({ kind: "edit", story: STORY });
  });

  it("opens a Story from the finder in the list", () => {
    const shell = env();

    openFoundStory(shell, STORY);

    expect(shell.setOverlay).toHaveBeenCalledWith(null);
    expect(shell.setStoryPane).toHaveBeenCalledWith({ kind: "edit", story: STORY });
  });

  it("gives the focus to the list when it hides the sidebar", () => {
    const shown = env({}, true);
    const hidden = env({}, false);

    toggleSidebar(shown);
    toggleSidebar(hidden);

    expect(shown.setPane).toHaveBeenCalledWith("stories");
    expect(shown.setSidebarShown).toHaveBeenCalledWith(false);
    expect(hidden.setPane).not.toHaveBeenCalled();
    expect(hidden.setSidebarShown).toHaveBeenCalledWith(true);
  });

  it("filters by a saved Stage and reads the board again", () => {
    const shell = env();

    showSavedStage(shell, { key: "DONE" } as Stage);

    expect(shell.setStageKey).toHaveBeenCalledWith("DONE");
    expect(shell.setOverlay).toHaveBeenCalledWith(null);
    expect(shell.reload).toHaveBeenCalledOnce();
  });

  it("opens a different Project with no filter, and only closes for the open Project", () => {
    const shell = env();
    const same = env();

    switchProject(shell, "/q");
    switchProject(same, "/p");

    expect(shell.setCtx).toHaveBeenCalledWith({ home: "/home", cwd: "/q" });
    expect(shell.setStageKey).toHaveBeenCalledWith(null);
    expect(same.setOverlay).toHaveBeenCalledWith(null);
    expect(same.setCtx).not.toHaveBeenCalled();
  });
});
