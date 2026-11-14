import { describe, expect, it, vi } from "vitest";
import type { Project } from "../../../services/project/project.js";
import type { Stage } from "../../../services/stage/stage.js";
import type { Story } from "../../../services/story/story.js";
import { SIDEBAR_WIDTH } from "../../components/index.js";
import { createShellRegistry, createToastStore } from "../../hooks/index.js";
import { shellFrame } from "./shell-frame.js";
import { headerProps, overlayHandlers, stageSidebarProps, storyPanelProps, storySidebarProps } from "./shell-props.js";
import type { Board, ShellEnv } from "./shell-state.js";
import { type ShellViewInput, shellView } from "./shell-view.js";

const BOARD: Board = {
  project: { root: "/p", projectName: "Rowbly" } as Project,
  stages: [{ key: "BACKLOG", label: "Backlog" } as Stage],
  stories: [{ id: "ROW-01", number: 1, title: "One", stage: "BACKLOG", position: 1 } as Story],
  activity: { path: "", status: "ok", stories: {} },
};

function env(data: ShellViewInput["data"], change: Partial<ShellViewInput> = {}): ShellEnv {
  const view = shellView({
    data,
    active: true,
    overlay: null,
    pane: "stories",
    storyPane: null,
    mode: "stories",
    sidebarShown: true,
    stageKey: null,
    selectedId: null,
    collapsed: new Set(),
    ...change,
  });

  return {
    ctx: {},
    view,
    stageKey: null,
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

const OPEN = { loading: false, data: BOARD };

describe("shell props", () => {
  it("shows only the Project Button in the header without a Project", () => {
    const loading = headerProps(env({ loading: true, data: undefined }), undefined);
    const none = headerProps(env({ loading: false, data: null }), undefined);

    expect(loading.project?.name).toBe("Loading…");
    expect(none.project?.name).toBe("No Project");
    expect([none.finder, none.factory, none.settings, none.newStory]).toEqual([
      undefined,
      undefined,
      undefined,
      undefined,
    ]);
  });

  it("opens the overlays from the header of an open Project", () => {
    const shell = env(OPEN);
    const header = headerProps(shell, undefined);

    header.finder?.onClick();
    header.newStory?.onClick();

    expect(header.project?.name).toBe("Rowbly");
    expect(header.newStory?.showKey).toBe(true);
    expect(shell.setOverlay).toHaveBeenCalledExactlyOnceWith({ kind: "finder" });
    expect(shell.setStoryPane).toHaveBeenCalledWith({ kind: "new" });
  });

  it("gives the sidebar All Stages first, and lets it resize only beside the list", () => {
    const shell = env(OPEN);
    const beside = stageSidebarProps(shell, shellFrame({ width: 120, height: 40 }, shell.view, SIDEBAR_WIDTH));
    const stacked = stageSidebarProps(shell, shellFrame({ width: 50, height: 40 }, shell.view, SIDEBAR_WIDTH));

    beside.onSelect("*");

    expect(beside.entries.map((entry) => entry.id)).toEqual(["*", "BACKLOG"]);
    expect(beside.onResize).toBe(shell.setSidebarWidth);
    expect(stacked.onResize).toBeUndefined();
    expect(stacked.width).toBe(50);
    expect(shell.setStageKey).toHaveBeenCalledWith(null);
  });

  it("shows the first load, the onboarding steps, the Stories or a read error in the Story panel", () => {
    const frame = (shell: ShellEnv) => shellFrame({ width: 120 }, shell.view, SIDEBAR_WIDTH);
    const panel = (shell: ShellEnv) => storyPanelProps(shell, frame(shell));

    expect(panel(env({ loading: true, data: undefined })).body.kind).toBe("loading");
    expect(panel(env({ loading: false, data: null })).body.kind).toBe("onboarding");
    expect(panel(env({ loading: false, data: undefined })).body.kind).toBe("error");
    expect(panel(env(OPEN))).toMatchObject({ title: "Rowbly › All Stages", body: { kind: "board" } });
    expect(panel(env(OPEN, { overlay: { kind: "help" } })).onClick).toBeUndefined();
  });

  it("opens the AI settings from the Factory controls", () => {
    const shell = env(OPEN);

    overlayHandlers(shell).openAiSettings();

    expect(shell.setOverlay).toHaveBeenCalledWith({ kind: "settings", section: "ai" });
  });

  it("gives the Story sidebar its size, its focus and its handlers, and closes it with the ✕", () => {
    const closed = env(OPEN);
    const shell = env(OPEN, { storyPane: { kind: "new" }, pane: "story" });
    const frame = shellFrame({ width: 150, height: 40 }, shell.view, SIDEBAR_WIDTH);
    const props = storySidebarProps(shell, frame);

    expect(storySidebarProps(closed, shellFrame({ width: 150 }, closed.view, SIDEBAR_WIDTH))).toBeUndefined();
    expect(props).toMatchObject({ width: 60, shown: true, focused: true, clickable: true });
    expect(props?.onResize).toBe(shell.setStoryWidth);
    props?.onBack();
    expect(shell.setPane).toHaveBeenCalledWith("stories");
    props?.onClose();
    expect(shell.setStoryPane).toHaveBeenCalledWith(null);
  });

  it("asks before the ✕ discards the unsaved changes of the Story sidebar", () => {
    const shell = env(OPEN, { storyPane: { kind: "new" }, pane: "story" });

    shell.registry.setDirty(-1, "form", true);
    storySidebarProps(shell, shellFrame({ width: 150 }, shell.view, SIDEBAR_WIDTH))?.onClose();

    expect(shell.setStoryPane).not.toHaveBeenCalled();
    expect(shell.setOverlay).toHaveBeenCalledWith({ kind: "discardStory", next: null });
    overlayHandlers(shell).discardStory(null);
    expect(shell.setStoryPane).toHaveBeenCalledWith(null);
  });

  it("does not drag the full Story sidebar of a narrow terminal", () => {
    const shell = env(OPEN, { storyPane: { kind: "new" }, pane: "story" });
    const props = storySidebarProps(shell, shellFrame({ width: 80, height: 30 }, shell.view, SIDEBAR_WIDTH));

    expect(props).toMatchObject({ width: 80, shown: true });
    expect(props?.onResize).toBeUndefined();
  });

  it("shows the switch in the header, and hides the n key of + New Story in threads mode", () => {
    const stories = env(OPEN);
    const threads = env(OPEN, { mode: "threads" });

    headerProps(stories, undefined).viewSwitch?.onToggle();

    expect(headerProps(stories, undefined).viewSwitch?.threads).toBe(false);
    expect(headerProps(threads, undefined).viewSwitch?.threads).toBe(true);
    expect(headerProps(threads, undefined).newStory?.showKey).toBe(false);
    expect(headerProps(env({ loading: false, data: null }), undefined).viewSwitch).toBeUndefined();
    expect(stories.setMode).toHaveBeenCalledOnce();
  });

  it("shows the Factory view with the title Threads and the Stage of the filter in threads mode", () => {
    const shell = env(OPEN, { mode: "threads", stageKey: "BACKLOG" });
    const panel = storyPanelProps(shell, shellFrame({ width: 120 }, shell.view, SIDEBAR_WIDTH));

    expect(panel.title).toBe("Threads");
    expect(panel.body).toMatchObject({
      kind: "threads",
      view: { root: "/p", stage: "BACKLOG", stages: { BACKLOG: "Backlog" }, active: true, clickable: true },
    });
    if (panel.body.kind !== "threads") {
      throw new Error("The body is not the Factory view");
    }
    expect(panel.body.view.emptyText).toBe("No Threads in Backlog. The factory adds a Thread when it starts a worker.");
    const thread = { id: "t1" } as never;
    panel.body.view.onOpen(thread);
    expect(shell.setOverlay).toHaveBeenCalledWith({ kind: "thread", thread });
  });
});
