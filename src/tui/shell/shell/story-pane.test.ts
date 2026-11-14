import { describe, expect, it, vi } from "vitest";
import type { Project } from "../../../services/project/project.js";
import type { Story } from "../../../services/story/story.js";
import type { ThreadRecord } from "../../../services/thread/thread.js";
import { createShellRegistry, createToastStore } from "../../hooks/index.js";
import type { SidePane } from "../overlay.js";
import type { Board, ShellEnv } from "./shell-state.js";
import { shellView } from "./shell-view.js";
import {
  closeDeletedStory,
  discardStory,
  editStory,
  newStory,
  openOverlayThread,
  openThread,
  requestStoryPane,
} from "./story-pane.js";

const STORY = { id: "ROW-01", stage: "BACKLOG", position: 1 } as Story;
const THREAD = { id: "t1", storyId: "ROW-01" } as ThreadRecord;
const OTHER = { id: "ROW-02", stage: "BACKLOG", position: 2 } as Story;
const BOARD: Board = {
  project: { root: "/p", projectName: "Rowbly" } as Project,
  stages: [],
  stories: [STORY, OTHER],
  activity: { path: "", status: "ok", stories: {} },
};

function env(storyPane: SidePane | null, dirty = false): ShellEnv {
  const registry = createShellRegistry();

  if (dirty) {
    registry.setDirty(-1, "form", true);
  }

  return {
    ctx: {},
    view: shellView({
      data: { loading: false, data: BOARD },
      active: true,
      overlay: null,
      pane: "stories",
      storyPane,
      mode: "stories",
      sidebarShown: true,
      stageKey: null,
      selectedId: null,
      collapsed: new Set(),
    }),
    stageKey: null,
    sidebarShown: true,
    registry,
    toast: createToastStore(),
    exit: vi.fn(),
    reload: vi.fn(),
    setCtx: vi.fn(),
    setThreadHints: vi.fn(),
    setMode: vi.fn(),
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

/** The pane that the last `setPane` updater gives after `pane`. */
function paneAfter(shell: ShellEnv, pane: string): unknown {
  const update = vi.mocked(shell.setPane).mock.lastCall?.[0];
  return typeof update === "function" ? update(pane as never) : update;
}

describe("Story sidebar panes", () => {
  it("opens a form at once without unsaved changes, and gives it the focus", () => {
    const shell = env({ kind: "edit", story: STORY });

    editStory(shell, OTHER);

    expect(shell.setStoryPane).toHaveBeenCalledWith({ kind: "edit", story: OTHER });
    expect(paneAfter(shell, "stories")).toBe("story");
  });

  it("asks before it replaces or closes a form with unsaved changes", () => {
    const shell = env({ kind: "edit", story: STORY }, true);

    newStory(shell);
    requestStoryPane(shell, null);

    expect(shell.setStoryPane).not.toHaveBeenCalled();
    expect(shell.setOverlay).toHaveBeenNthCalledWith(1, { kind: "discardStory", next: { kind: "new" } });
    expect(shell.setOverlay).toHaveBeenNthCalledWith(2, { kind: "discardStory", next: null });
  });

  it("only focuses the form that is open already, also with unsaved changes", () => {
    const shell = env({ kind: "edit", story: STORY }, true);

    editStory(shell, STORY);

    expect(shell.setOverlay).not.toHaveBeenCalled();
    expect(paneAfter(shell, "stories")).toBe("story");
  });

  it("closes the form after a confirmed discard, and gives the focus back to the list", () => {
    const shell = env({ kind: "new" }, true);

    discardStory(shell, null);

    expect(shell.setOverlay).toHaveBeenCalledWith(null);
    expect(shell.setStoryPane).toHaveBeenCalledWith(null);
    expect(paneAfter(shell, "story")).toBe("stories");
    expect(paneAfter(shell, "stages")).toBe("stages");
  });

  it("shows a Thread in place of a form, and asks first when the form has unsaved changes", () => {
    const clean = env({ kind: "edit", story: STORY });
    const dirty = env({ kind: "new" }, true);

    openThread(clean, THREAD);
    openThread(dirty, THREAD);

    expect(clean.setStoryPane).toHaveBeenCalledWith({ kind: "thread", thread: THREAD });
    expect(paneAfter(clean, "stories")).toBe("story");
    expect(dirty.setStoryPane).not.toHaveBeenCalled();
    expect(dirty.setOverlay).toHaveBeenCalledWith({ kind: "discardStory", next: { kind: "thread", thread: THREAD } });
  });

  it("replaces or closes a Thread without a question, because a Thread is never dirty", () => {
    const shell = env({ kind: "thread", thread: THREAD }, true);

    editStory(shell, STORY);
    requestStoryPane(shell, null);

    expect(shell.setOverlay).not.toHaveBeenCalled();
    expect(shell.setStoryPane).toHaveBeenNthCalledWith(1, { kind: "edit", story: STORY });
    expect(shell.setStoryPane).toHaveBeenNthCalledWith(2, null);
  });

  it("only focuses the Thread that is open already", () => {
    const shell = env({ kind: "thread", thread: THREAD });

    openThread(shell, { ...THREAD });

    expect(shell.setStoryPane).toHaveBeenCalledWith({ kind: "thread", thread: THREAD });
    expect(paneAfter(shell, "stories")).toBe("story");
  });

  it("closes the overlay before it shows the Thread of a factory warning", () => {
    const shell = env(null);

    openOverlayThread(shell, THREAD);

    expect(shell.setOverlay).toHaveBeenCalledWith(null);
    expect(shell.setStoryPane).toHaveBeenCalledWith({ kind: "thread", thread: THREAD });
  });

  it("closes the form of a deleted Story only", () => {
    const shell = env({ kind: "edit", story: STORY });

    closeDeletedStory(shell, "ROW-02");
    expect(shell.setStoryPane).not.toHaveBeenCalled();
    closeDeletedStory(shell, "ROW-01");
    expect(shell.setStoryPane).toHaveBeenCalledWith(null);
  });
});
