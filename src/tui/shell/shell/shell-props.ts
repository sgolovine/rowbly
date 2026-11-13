import type { ComponentProps } from "react";
import type { FactoryStatus } from "../../../services/factory/factory.js";
import type { Sidebar } from "../../components/index.js";
import type { Header } from "../header/index.js";
import type { OverlayHandlers } from "../overlay.js";
import type { StoryPanel, StoryPanelBody } from "../story-panel/index.js";
import type { ShellFrame } from "./shell-frame.js";
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
} from "./shell-selection.js";
import { ALL_STAGES, type ShellEnv } from "./shell-state.js";
import { afterDelete, dropStory, moveStage, removeStory } from "./story-changes.js";

/** The header: the Project Button, and the controls of an open Project. */
export function headerProps(env: ShellEnv, factory: FactoryStatus | undefined): ComponentProps<typeof Header> {
  const { board, idle, loading, sidebarFocused } = env.view;
  const open = board !== undefined;

  return {
    project: {
      name: board?.project.projectName ?? (loading ? "Loading…" : "No Project"),
      onClick: () => env.setOverlay({ kind: "projects" }),
    },
    finder: open ? { onClick: () => env.setOverlay({ kind: "finder" }) } : undefined,
    factory: open ? { status: factory, onClick: () => env.setOverlay({ kind: "factory" }) } : undefined,
    settings: open ? { onClick: () => env.setOverlay({ kind: "settings" }) } : undefined,
    newStory: open ? { onClick: () => env.setOverlay({ kind: "newStory" }), showKey: !sidebarFocused } : undefined,
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
  const { board, noProject, stage } = env.view;
  const projectName = board?.project.projectName;

  if (projectName) {
    return `${projectName} › ${stage?.label ?? "All Stages"}`;
  }

  return noProject ? "Set up Rowbly" : "Stories";
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

/** What the overlays do when they close or change a record. */
export function overlayHandlers(env: ShellEnv): OverlayHandlers {
  return {
    close: () => closeOverlay(env),
    openStory: (story) => openFoundStory(env, story),
    storySaved: (story) => showSavedStory(env, story),
    storyDeleted: (id) => afterDelete(env, id),
    removeStory: (story) => removeStory(env, story),
    stageSaved: (stage) => showSavedStage(env, stage),
    openAiSettings: () => env.setOverlay({ kind: "settings", section: "ai" }),
    switchProject: (path) => switchProject(env, path),
    reload: env.reload,
  };
}
