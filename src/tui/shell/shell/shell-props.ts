import type { ComponentProps } from "react";
import { compactThreads, projectTags, type TagConfig } from "../../../services/config/config.js";
import type { FactoryStatus } from "../../../services/factory/factory.js";
import type { Stage } from "../../../services/stage/stage.js";
import type { ServiceContext } from "../../../services/workspace/workspace.js";
import type { Sidebar, SidebarEntry } from "../../components/index.js";
import type { FactoryView } from "../../screens/threads/index.js";
import type { Header } from "../header/index.js";
import type { StoryPanelBody } from "../story-panel/index.js";
import type { StorySidebarExpand, StorySidebarProps } from "../story-sidebar/index.js";
import type { ShellFrame } from "./shell-frame.js";
import type { ShellHandlers } from "./shell-handlers.js";
import {
  ALL_STAGES,
  ALL_TAGS,
  type Board,
  type ShellEnv,
  type ShellView,
  type StoryListRow,
  type ViewMode,
} from "./shell-state.js";

/** The values of the header. The memo of the header props depends on each of them. */
export interface HeaderInput {
  readonly name: string;
  readonly open: boolean;
  readonly factory: FactoryStatus | undefined;
  readonly threads: boolean;
  readonly showKey: boolean;
  readonly clickable: boolean;
}

/** The values of the body of the Story panel. The memo of the body depends on each of them. */
export interface PanelInput {
  readonly ctx: ServiceContext;
  readonly board: Board | undefined;
  readonly loading: boolean;
  readonly noProject: boolean;
  readonly mode: ViewMode;
  readonly stage: Stage | undefined;
  readonly tag: TagConfig | undefined;
  readonly rows: readonly StoryListRow[];
  readonly cursor: number;
  readonly marked: ReadonlySet<string>;
  readonly idle: boolean;
  readonly listFocused: boolean;
  readonly statusLine: boolean;
  readonly listInnerHeight: number | undefined;
}

/** The header: the Project Button, and the controls of an open Project. */
export function headerProps(handlers: ShellHandlers, input: HeaderInput): ComponentProps<typeof Header> {
  const { name, open, factory, threads, showKey, clickable } = input;

  return {
    project: { name, onClick: handlers.openProjects },
    finder: open ? { onClick: handlers.openFinder } : undefined,
    factory: open ? { status: factory, onClick: handlers.openFactory } : undefined,
    viewSwitch: open ? { threads, onToggle: handlers.toggleMode } : undefined,
    checks: open ? { onClick: handlers.openChecks } : undefined,
    settings: open ? { onClick: handlers.openSettings } : undefined,
    newStory: open ? { onClick: handlers.newStory, showKey } : undefined,
    clickable,
  };
}

/** The entries of the Stage sidebar. Entry 0 is All Stages, so the index of an entry is the position of its Stage. */
export function stageEntries(stages: readonly Stage[]): readonly SidebarEntry[] {
  return [
    { id: ALL_STAGES, label: "All Stages" },
    ...stages.map((s) => ({ id: s.key, label: s.label, editable: true, movable: true })),
  ];
}

/** The Stage sidebar. `entries` and `button` come from the caller, which keeps their references. */
export function stageSidebarProps(
  handlers: ShellHandlers,
  view: ShellView,
  frame: ShellFrame,
  parts: Pick<ComponentProps<typeof Sidebar>, "entries" | "button">,
): ComponentProps<typeof Sidebar> {
  return {
    title: "Stages",
    entries: parts.entries,
    current: view.stageIndex,
    height: frame.stagesHeight,
    width: frame.stacked ? frame.width : frame.shownWidth,
    maxWidth: frame.room,
    onResize: frame.stacked ? undefined : handlers.resizeStages,
    focused: view.sidebarFocused,
    clickable: view.idle,
    onFocus: handlers.focusStages,
    onSelect: handlers.filterStage,
    onEdit: handlers.editStage,
    onMove: handlers.moveStage,
    button: parts.button,
  };
}

/** The entries of the tag sidebar: All Tags, then each tag in config order, with its label. */
export function tagEntries(tags: readonly TagConfig[]): readonly SidebarEntry[] {
  return [{ id: ALL_TAGS, label: "All Tags" }, ...tags.map((tag) => ({ id: tag.value, label: tag.label }))];
}

/**
 * The tag sidebar below the Stage sidebar, or `undefined` when it does not show. It has the width of the Stage
 * sidebar, and only the Stage sidebar changes the width. `entries` comes from the caller, which keeps its reference.
 */
export function tagSidebarProps(
  handlers: ShellHandlers,
  view: ShellView,
  frame: ShellFrame,
  entries: readonly SidebarEntry[],
): ComponentProps<typeof Sidebar> | undefined {
  if (!view.tagSidebar) {
    return;
  }

  return {
    title: "Tags",
    entries,
    current: view.tagIndex,
    height: frame.tagsHeight,
    width: frame.stacked ? frame.width : frame.shownWidth,
    maxWidth: frame.room,
    focused: view.tagSidebarFocused,
    clickable: view.idle,
    onFocus: handlers.focusTags,
    onSelect: handlers.filterTag,
  };
}

/** The title of the Story panel. */
export function panelTitle(view: ShellView): string {
  const { board, noProject, stage, tag, mode } = view;
  const projectName = board?.project.projectName;

  if (board && mode === "threads") {
    return "Threads";
  }

  if (projectName) {
    return `${projectName} › ${stage?.label ?? "All Stages"}${tag ? ` › ${tag.label}` : ""}`;
  }

  return noProject ? "Set up Rowbly" : "Stories";
}

/** The Factory view: the worker Threads of the Stage of the filter, or of all Stages. */
function factoryViewProps(
  handlers: ShellHandlers,
  input: PanelInput,
  board: Board,
): ComponentProps<typeof FactoryView> {
  const { stage } = input;

  return {
    ctx: input.ctx,
    root: board.project.root,
    stage: stage?.key,
    stages: Object.fromEntries(board.stages.map((s) => [s.key, s.label])),
    active: input.listFocused,
    clickable: input.idle,
    compact: compactThreads(board.project),
    emptyText: `No Threads${stage ? ` in ${stage.label}` : ""}. The factory adds a Thread when it starts a worker.`,
    onOpen: handlers.openThread,
    onHints: handlers.threadHints,
  };
}

/** The text of an empty Story list. It names the Stage and the tag of the filters. */
function emptyListText(stage: Stage | undefined, tag: TagConfig | undefined): string {
  const where = stage ? ` in ${stage.label}` : "";

  if (tag) {
    return `No Stories${where} with the tag ${tag.label}.`;
  }

  return stage ? `No Stories${where}.` : "No Stories yet. Press n to create one.";
}

/** The Story list of an open Project. */
function boardBody(handlers: ShellHandlers, input: PanelInput, board: Board): StoryPanelBody {
  return {
    kind: "board",
    activity: board.activity,
    statusLine: input.statusLine,
    list: {
      rows: input.rows,
      activity: board.activity.stories,
      tags: projectTags(board.project),
      cursor: input.cursor,
      marked: input.marked,
      clickable: input.idle,
      height: input.listInnerHeight,
      emptyText: emptyListText(input.stage, input.tag),
      onCursor: handlers.pointRow,
      onMove: handlers.dropStory,
      onActivate: handlers.clickRow,
      onRange: handlers.markRange,
      onClear: handlers.clearMarks,
    },
  };
}

/** What the Story panel shows. */
export function panelBody(handlers: ShellHandlers, input: PanelInput): StoryPanelBody {
  const { board, loading, noProject } = input;

  if (loading && !board) {
    return { kind: "loading" };
  }

  if (!board) {
    return noProject
      ? {
          kind: "onboarding",
          ctx: input.ctx,
          active: input.idle,
          onHints: handlers.onboardingHints,
          onCreated: handlers.reload,
        }
      : { kind: "error" };
  }

  if (input.mode === "threads") {
    return { kind: "threads", view: factoryViewProps(handlers, input, board) };
  }

  return boardBody(handlers, input, board);
}

/** The Story sidebar, or `undefined` while it is closed. `expand` comes from the caller, which keeps its reference. */
export function storySidebarProps(
  handlers: ShellHandlers,
  env: ShellEnv,
  frame: ShellFrame,
  expand: StorySidebarExpand | undefined,
): StorySidebarProps | undefined {
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
    // An expanded Story sidebar has no list beside it, so its edge does not drag.
    onResize: story.mode === "beside" && !story.expanded ? handlers.resizeStory : undefined,
    // A Story sidebar that covers the main area of a narrow terminal cannot expand.
    expand,
    shown: story.shown,
    focused: storyFocused,
    clickable: idle && story.shown,
    onFocus: handlers.focusStory,
    onClose: handlers.closeStory,
    onBack: handlers.leaveStory,
    onTab: handlers.tabPane,
    onSaved: handlers.savedStory,
    onDeleted: handlers.deletedStory,
    onOpenStory: handlers.openStory,
    onHints: handlers.storyHints,
  };
}
