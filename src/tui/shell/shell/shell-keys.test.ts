import type { Key } from "ink";
import { describe, expect, it, vi } from "vitest";
import type { Project } from "../../../services/project/project.js";
import type { Stage } from "../../../services/stage/stage.js";
import type { Story } from "../../../services/story/story.js";
import { createShellRegistry, createToastStore } from "../../hooks/index.js";
import { handleShellKey } from "./shell-keys.js";
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
    setPane: vi.fn(),
    setSidebarWidth: vi.fn(),
    setSidebarShown: vi.fn(),
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
    expect(list.setOverlay).toHaveBeenCalledWith({ kind: "newStory" });
    expect(sidebar.setOverlay).toHaveBeenCalledWith({ kind: "newStage" });
  });

  it("opens and deletes the selected Story, and selects the next Stage with ]", () => {
    const shell = env();

    handleShellKey(shell, "", key({ return: true }));
    handleShellKey(shell, "d", key());
    handleShellKey(shell, "]", key());

    expect(shell.setOverlay).toHaveBeenNthCalledWith(1, { kind: "editStory", story: STORY });
    expect(shell.setOverlay).toHaveBeenNthCalledWith(2, { kind: "deleteStory", story: STORY });
    expect(shell.setStageKey).toHaveBeenCalledWith("BACKLOG");
  });

  it("collapses the section of the Story on ←, and selects its heading", () => {
    const shell = env();

    handleShellKey(shell, "", key({ leftArrow: true }));

    expect(shell.setCollapsed).toHaveBeenCalledOnce();
    expect(shell.setSelectedId).toHaveBeenCalledWith("stage:BACKLOG");
  });
});
