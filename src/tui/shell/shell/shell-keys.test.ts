import type { Key } from "ink";
import { describe, expect, it, vi } from "vitest";
import type { FactoryStatus } from "../../../services/factory/factory.js";
import type { Project } from "../../../services/project/project.js";
import type { Stage } from "../../../services/stage/stage.js";
import type { Story } from "../../../services/story/story.js";
import { createShellRegistry, createToastStore } from "../../hooks/index.js";
import { cyclePane, handleShellKey } from "./shell-keys.js";
import type { Board, ShellEnv } from "./shell-state.js";
import { type ShellViewInput, shellView } from "./shell-view.js";

const STAGES = [{ key: "BACKLOG", label: "Backlog", position: 1 } as Stage, { key: "DONE", label: "Done" } as Stage];
const STORY = { id: "ROW-01", number: 1, title: "One", stage: "BACKLOG", position: 1 } as Story;
const BOARD: Board = {
  project: { root: "/p", projectName: "Rowbly" } as Project,
  stages: STAGES,
  stories: [STORY],
  activity: { path: "", status: "ok", stories: {} },
};

function key(change: Partial<Key> = {}): Key {
  return {
    ...{ upArrow: false, downArrow: false, leftArrow: false, rightArrow: false, pageDown: false, pageUp: false },
    ...{ home: false, end: false, return: false, escape: false, ctrl: false, shift: false, tab: false },
    ...{ backspace: false, delete: false, meta: false, super: false, hyper: false, capsLock: false, numLock: false },
    ...change,
  };
}

function env(change: Partial<ShellViewInput> = {}): ShellEnv {
  const view = shellView({
    data: { loading: false, data: BOARD },
    active: true,
    overlay: null,
    pane: "stories",
    storyPane: null,
    mode: "stories",
    sidebarShown: true,
    stageKey: null,
    selectedId: "ROW-01",
    collapsed: new Set(),
    ...change,
  });

  return {
    ctx: {},
    view,
    stageKey: change.stageKey ?? null,
    sidebarShown: true,
    registry: createShellRegistry(),
    toast: createToastStore(),
    exit: vi.fn(),
    reload: vi.fn(),
    setCtx: vi.fn(),
    setOverlay: vi.fn(),
    setOnboardingHints: vi.fn(),
    setThreadHints: vi.fn(),
    setMode: vi.fn(),
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

describe("handleShellKey", () => {
  it("quits on q and opens the help and the Project switcher", () => {
    const shell = env();

    handleShellKey(shell, "q", key());
    handleShellKey(shell, "?", key());
    handleShellKey(shell, "p", key());

    expect(shell.exit).toHaveBeenCalledOnce();
    expect(shell.setOverlay).toHaveBeenNthCalledWith(1, { kind: "help" });
    expect(shell.setOverlay).toHaveBeenNthCalledWith(2, { kind: "projects" });
  });

  it("opens the overlays of a Project only when a Project is open", () => {
    const none = env({ data: { loading: false, data: null } });
    const open = env();

    handleShellKey(none, ",", key());
    handleShellKey(none, "f", key());
    handleShellKey(open, ",", key());
    handleShellKey(open, "f", key());

    expect(none.setOverlay).not.toHaveBeenCalled();
    expect(open.setOverlay).toHaveBeenNthCalledWith(1, { kind: "settings" });
    expect(open.setOverlay).toHaveBeenNthCalledWith(2, { kind: "factory" });
  });

  it("opens the Checks Modal on c only while the live factory has a check queue", () => {
    const checks = { running: 1, queued: 0, maxConcurrent: 2, jobs: [] };
    const live = { version: 1, phase: "ready", liveness: "alive", checks } as FactoryStatus;
    const cases: [FactoryStatus | undefined, boolean][] = [
      [live, true],
      [undefined, false],
      [{ ...live, phase: "stopped" }, false],
      [{ ...live, checks: undefined }, false],
    ];

    for (const [factory, opens] of cases) {
      const shell = { ...env(), factory };

      handleShellKey(shell, "c", key());

      if (opens) {
        expect(shell.setOverlay).toHaveBeenCalledWith({ kind: "checks" });
      } else {
        expect(shell.setOverlay).not.toHaveBeenCalled();
      }
    }

    const none = { ...env({ data: { loading: false, data: null } }), factory: live };

    handleShellKey(none, "c", key());

    expect(none.setOverlay).not.toHaveBeenCalled();
  });

  it("does not take the keys of the onboarding text fields", () => {
    const none = env({ data: { loading: false, data: null } });

    none.registry.capture({ text: true, escape: false });
    handleShellKey(none, "q", key());

    expect(none.exit).not.toHaveBeenCalled();
  });

  it("ignores a key that is the name of an object property", () => {
    const shell = env();

    handleShellKey(shell, "constructor", key());

    expect(shell.setOverlay).not.toHaveBeenCalled();
  });

  it("hides the sidebar on ctrl+b, finds on ctrl+p and ignores other ctrl keys", () => {
    const shell = env();

    handleShellKey(shell, "b", key({ ctrl: true }));
    handleShellKey(shell, "p", key({ ctrl: true }));
    handleShellKey(shell, "q", key({ ctrl: true }));

    expect(shell.setSidebarShown).toHaveBeenCalledWith(false);
    expect(shell.setOverlay).toHaveBeenCalledExactlyOnceWith({ kind: "finder" });
    expect(shell.exit).not.toHaveBeenCalled();
  });

  it("moves the focus with tab, and creates a Stage or a Story with n in the pane in focus", () => {
    const list = env();
    const sidebar = env({ pane: "stages" });

    handleShellKey(list, "", key({ tab: true }));
    handleShellKey(list, "n", key());
    handleShellKey(sidebar, "n", key());

    expect(list.setPane).toHaveBeenCalledWith("stages");
    expect(list.setStoryPane).toHaveBeenCalledWith({ kind: "new" });
    expect(sidebar.setOverlay).toHaveBeenCalledWith({ kind: "newStage" });
  });

  it("moves the focus in the order Stage sidebar, Story list, Story sidebar", () => {
    const open = { kind: "new" } as const;

    expect(cyclePane(env({ storyPane: open }).view, 1)).toBe("story");
    expect(cyclePane(env({ storyPane: open }).view, -1)).toBe("stages");
    expect(cyclePane(env({ storyPane: open, pane: "stages" }).view, 1)).toBe("stories");
    expect(cyclePane(env({ storyPane: open, pane: "stages" }).view, -1)).toBe("story");
    expect(cyclePane(env({ storyPane: open, sidebarShown: false }).view, 1)).toBe("story");
    expect(cyclePane(env({ storyPane: null, sidebarShown: false }).view, 1)).toBe("stories");
    // From the Story sidebar, for example a Thread that takes tab.
    expect(cyclePane(env({ storyPane: open, pane: "story" }).view, 1)).toBe("stages");
    expect(cyclePane(env({ storyPane: open, pane: "story" }).view, -1)).toBe("stories");
  });

  it("closes the Story sidebar with esc in the Story list, and asks first when it has unsaved changes", () => {
    const clean = env({ storyPane: { kind: "new" } });
    const dirty = env({ storyPane: { kind: "new" } });

    dirty.registry.setDirty(-1, "form", true);
    handleShellKey(clean, "", key({ escape: true }));
    handleShellKey(dirty, "", key({ escape: true }));

    expect(clean.setStoryPane).toHaveBeenCalledWith(null);
    expect(dirty.setStoryPane).not.toHaveBeenCalled();
    expect(dirty.setOverlay).toHaveBeenCalledWith({ kind: "discardStory", next: null });
  });

  it("opens and deletes the selected Story, and selects the next Stage with ]", () => {
    const shell = env();

    handleShellKey(shell, "", key({ return: true }));
    handleShellKey(shell, "d", key());
    handleShellKey(shell, "]", key());

    expect(shell.setStoryPane).toHaveBeenCalledWith({ kind: "edit", story: STORY });
    expect(shell.setOverlay).toHaveBeenCalledWith({ kind: "deleteStory", story: STORY });
    expect(shell.setStageKey).toHaveBeenCalledWith("BACKLOG");
  });

  it("asks before it opens a different Story over unsaved changes in the Story sidebar", () => {
    const shell = env({ storyPane: { kind: "new" } });

    shell.registry.setDirty(-1, "form", true);
    handleShellKey(shell, "", key({ return: true }));

    expect(shell.setStoryPane).not.toHaveBeenCalled();
    expect(shell.setOverlay).toHaveBeenCalledWith({ kind: "discardStory", next: { kind: "edit", story: STORY } });
  });

  it("collapses the section of the Story on ←, and selects its heading", () => {
    const shell = env();

    handleShellKey(shell, "", key({ leftArrow: true }));

    expect(shell.setCollapsed).toHaveBeenCalledOnce();
    expect(shell.setSelectedId).toHaveBeenCalledWith("stage:BACKLOG");
  });

  it("changes the view mode with t when a Project is open, also from the sidebar", () => {
    const list = env();
    const sidebar = env({ pane: "stages" });
    const none = env({ data: { loading: false, data: null } });

    handleShellKey(list, "t", key());
    handleShellKey(sidebar, "t", key());
    handleShellKey(none, "t", key());

    expect(list.setMode).toHaveBeenCalledOnce();
    expect(sidebar.setMode).toHaveBeenCalledOnce();
    expect(none.setMode).not.toHaveBeenCalled();
    const toggle = vi.mocked(list.setMode).mock.calls[0]?.[0] as (mode: string) => string;
    expect(toggle("stories")).toBe("threads");
    expect(toggle("threads")).toBe("stories");
  });

  it("gives the keys of the list to the Factory view in threads mode, and keeps the sidebar and f", () => {
    const threads = env({ mode: "threads" });
    const sidebar = env({ mode: "threads", pane: "stages" });

    handleShellKey(threads, "n", key());
    handleShellKey(threads, "d", key());
    handleShellKey(threads, "", key({ return: true }));
    handleShellKey(threads, "", key({ downArrow: true }));
    handleShellKey(threads, "", key({ shift: true, downArrow: true }));
    handleShellKey(threads, "", key({ ctrl: true, shift: true, downArrow: true }));
    handleShellKey(threads, "", key({ leftArrow: true }));
    handleShellKey(threads, "f", key());
    handleShellKey(threads, "]", key());
    handleShellKey(threads, "", key({ tab: true }));
    handleShellKey(sidebar, "n", key());

    expect(threads.setOverlay).toHaveBeenCalledExactlyOnceWith({ kind: "factory" });
    expect(threads.setSelectedId).not.toHaveBeenCalled();
    expect(threads.setCollapsed).not.toHaveBeenCalled();
    expect(threads.reload).not.toHaveBeenCalled();
    expect(threads.setStageKey).toHaveBeenCalledWith("BACKLOG");
    expect(threads.setPane).toHaveBeenCalledWith("stages");
    expect(sidebar.setOverlay).toHaveBeenCalledWith({ kind: "newStage" });
  });
});
