import type { ComponentProps } from "react";
import type { FactoryStatus } from "../../../services/factory/factory.js";
import type { Sidebar } from "../../components/index.js";
import type { FactoryView } from "../../screens/threads/index.js";
import type { Header } from "../header/index.js";
import type { OverlayHandlers } from "../overlay.js";
import type { StoryPanel, StoryPanelBody } from "../story-panel/index.js";
import type { StorySidebarProps } from "../story-sidebar/index.js";
import type { ShellFrame } from "./shell-frame.js";
import { cyclePane } from "./shell-keys.js";
import {
  clickRow,
  closeOverlay,
  editStageByKey,
  filterStage,
  openFoundStory,
  pointRow,
  showSavedStage,
  showSavedStory,
  switchProject,
  toggleMode,
} from "./shell-selection.js";
import { ALL_STAGES, type Board, type ShellEnv } from "./shell-state.js";
import { afterDelete, dropStory, moveStage, removeStory } from "./story-changes.js";
import { discardStory, newStory, openOverlayThread, openThread, requestStoryPane } from "./story-pane.js";

/** The header: the Project Button, and the controls of an open Project. */
export function headerProps(env: ShellEnv, factory: FactoryStatus | undefined): ComponentProps<typeof Header> {
  const { board, idle, loading, sidebarFocused, storyFocused, mode } = env.view;
  const open = board !== undefined;

  return {
    project: {
      name: board?.project.projectName ?? (loading ? "Loading…" : "No Project"),
      onClick: () => env.setOverlay({ kind: "projects" }),
    },
    finder: open ? { onClick: () => env.setOverlay({ kind: "finder" }) } : undefined,
    factory: open ? { status: factory, onClick: () => env.setOverlay({ kind: "factory" }) } : undefined,
    viewSwitch: open ? { threads: mode === "threads", onToggle: () => toggleMode(env) } : undefined,
    settings: open ? { onClick: () => env.setOverlay({ kind: "settings" }) } : undefined,
    newStory: open
      ? { onClick: () => newStory(env), showKey: !sidebarFocused && !storyFocused && mode === "stories" }
      : undefined,
    clickable: idle,
  };
}

/** The Stage sidebar. Row 0 is All Stages, so the index of a row is the position of its Stage. */
export function stageSidebarProps(env: ShellEnv, frame: ShellFrame): ComponentProps<typeof Sidebar> {
  const { stages, stageIndex, sidebarFocused, idle } = env.view;

  return {
    title: "Stages",
    entries: [
      { id: ALL_STAGES, label: "All Stages" },
      ...stages.map((s) => ({ id: s.key, label: s.label, editable: true, movable: true })),
    ],
    current: stageIndex,
    height: frame.stacked ? frame.stackedHeight || undefined : frame.mainHeight,
    width: frame.stacked ? frame.width : frame.shownWidth,
    maxWidth: frame.room,
    onResize: frame.stacked ? undefined : env.setSidebarWidth,
    focused: sidebarFocused,
    clickable: idle,
    onFocus: () => env.setPane("stages"),
    onSelect: (id) => filterStage(env, id),
    onEdit: (id) => editStageByKey(env, id),
    // A drop on All Stages moves the Stage to position 1.
    onMove: (id, index) => moveStage(env, id, index),
    button: { label: "+ New Stage", onClick: () => env.setOverlay({ kind: "newStage" }) },
  };
}

function panelTitle(env: ShellEnv): string {
  const { board, noProject, stage, mode } = env.view;
  const projectName = board?.project.projectName;

  if (board && mode === "threads") {
    return "Threads";
  }

  if (projectName) {
    return `${projectName} › ${stage?.label ?? "All Stages"}`;
  }

  return noProject ? "Set up Rowbly" : "Stories";
}

/** The Factory view: the worker Threads of the Stage of the filter, or of all Stages. */
function factoryViewProps(env: ShellEnv, board: Board): ComponentProps<typeof FactoryView> {
  const { stage, listFocused, idle } = env.view;

  return {
    ctx: env.ctx,
    root: board.project.root,
    stage: stage?.key,
    stages: Object.fromEntries(board.stages.map((s) => [s.key, s.label])),
    active: listFocused,
    clickable: idle,
    emptyText: `No Threads${stage ? ` in ${stage.label}` : ""}. The factory adds a Thread when it starts a worker.`,
    onOpen: (thread) => openThread(env, thread),
    onHints: env.setThreadHints,
  };
}

function panelBody(env: ShellEnv, frame: ShellFrame): StoryPanelBody {
  const { board, loading, noProject, rows, cursor, stage, idle } = env.view;

  if (loading && !board) {
    return { kind: "loading" };
  }

  if (!board) {
    return noProject
      ? { kind: "onboarding", ctx: env.ctx, active: idle, onHints: env.setOnboardingHints, onCreated: env.reload }
      : { kind: "error" };
  }

  if (env.view.mode === "threads") {
    return { kind: "threads", view: factoryViewProps(env, board) };
  }

  return {
    kind: "board",
    activity: board.activity,
    statusLine: frame.statusLine,
    list: {
      rows,
      activity: board.activity.stories,
      cursor,
      clickable: idle,
      height: frame.listInnerHeight,
      emptyText: stage ? `No Stories in ${stage.label}.` : "No Stories yet. Press n to create one.",
      onCursor: (index) => pointRow(env, index),
      onMove: (id, gap) => dropStory(env, id, gap),
      onActivate: (index) => clickRow(env, index),
    },
  };
}

/** The Panel of the Story list. */
export function storyPanelProps(env: ShellEnv, frame: ShellFrame): ComponentProps<typeof StoryPanel> {
  return {
    title: panelTitle(env),
    focused: env.view.listFocused,
    height: frame.listHeight,
    inner: { width: frame.mainWidth, height: frame.listInnerHeight },
    onClick: env.view.idle ? () => env.setPane("stories") : undefined,
    body: panelBody(env, frame),
  };
}

/** The Story sidebar, or `undefined` while it is closed. */
export function storySidebarProps(env: ShellEnv, frame: ShellFrame): StorySidebarProps | undefined {
  const { board, storyPane, storyFocused, idle, cursorStage } = env.view;
  const { story } = frame;

  if (!board || !storyPane) {
    return;
  }

  return {
    pane: storyPane,
    board,
    ctx: env.ctx,
    cursorStage,
    width: story.width,
    height: story.height,
    maxWidth: story.room,
    onResize: story.mode === "beside" ? env.setStoryWidth : undefined,
    shown: story.shown,
    focused: storyFocused,
    clickable: idle && story.shown,
    onFocus: () => env.setPane("story"),
    onClose: () => requestStoryPane(env, null),
    onBack: () => env.setPane("stories"),
    onTab: (step) => env.setPane(cyclePane(env.view, step)),
    onSaved: (saved) => showSavedStory(env, saved),
    onDeleted: (id) => afterDelete(env, id),
    onHints: env.setStoryHints,
  };
}

/** What the overlays do when they close or change a record. */
export function overlayHandlers(env: ShellEnv): OverlayHandlers {
  return {
    close: () => closeOverlay(env),
    openStory: (story) => openFoundStory(env, story),
    openThread: (thread) => openOverlayThread(env, thread),
    discardStory: (next) => discardStory(env, next),
    removeStory: (story) => removeStory(env, story),
    stageSaved: (stage) => showSavedStage(env, stage),
    openAiSettings: () => env.setOverlay({ kind: "settings", section: "ai" }),
    switchProject: (path) => switchProject(env, path),
    reload: env.reload,
  };
}
