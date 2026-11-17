import type { Key } from "ink";
import { groupDelta, moveDelta, reorderDelta } from "../../keymap.js";
import { liveChecks } from "../../screens/factory/check-jobs.js";
import type { Overlay } from "../overlay.js";
import {
  collapseStory,
  editStage,
  fold,
  selectStage,
  selectStory,
  selectTag,
  toggleMode,
  toggleSidebar,
} from "./shell-selection.js";
import type { Pane, ShellEnv, ShellView, StoryListRow } from "./shell-state.js";
import { moveMarkedStories, moveStage, moveStoryStage } from "./story-changes.js";
import { clearMarks, endRange, hasMarks, startRange } from "./story-marks.js";
import { editStory, listPane, newStory, requestStoryPane, toggleStoryExpanded } from "./story-pane.js";

/** The keys that open an overlay, also without a Project. */
const APP_OVERLAYS: ReadonlyMap<string, Overlay> = new Map<string, Overlay>([
  ["?", { kind: "help" }],
  ["p", { kind: "projects" }],
]);

/** The keys that open an overlay of an open Project. */
const BOARD_OVERLAYS: ReadonlyMap<string, Overlay> = new Map<string, Overlay>([
  [",", { kind: "settings" }],
  ["f", { kind: "factory" }],
]);

/** `c` opens the Checks Modal while the live factory has a check queue. Otherwise the key does nothing. */
function checksKey(env: ShellEnv): void {
  if (liveChecks(env.factory)) {
    env.setOverlay({ kind: "checks" });
  }
}

/** `ctrl` keys: hide the sidebar, expand the Story sidebar, find a Story, or move a Story to another Stage. */
function ctrlKey(env: ShellEnv, input: string, key: Key): void {
  const { board, listFocused, row, mode } = env.view;
  const group = groupDelta(key);

  if (key.ctrl && input === "b") {
    toggleSidebar(env);
  } else if (key.ctrl && input === "o") {
    toggleStoryExpanded(env);
  } else if (key.ctrl && input === "p" && board) {
    env.setOverlay({ kind: "finder" });
  } else if (group && board && listFocused && mode === "stories" && row?.kind === "story") {
    moveStoryStage(env, row.story, group);
  }
}

/** The keys of the Stage sidebar. */
function sidebarKey(env: ShellEnv, input: string, delta: number, shift: -1 | 0 | 1): void {
  const { stage, stageIndex, stages } = env.view;

  if (shift && stage) {
    moveStage(env, stage.key, stageIndex + shift);
  } else if (delta) {
    selectStage(env, Math.max(0, Math.min(stages.length, stageIndex + delta)));
  } else if (input === "n") {
    env.setOverlay({ kind: "newStage" });
  } else if (input === "e") {
    editStage(env);
  }
}

/** The keys of the tag sidebar: `↑/↓` select the previous or next entry, and `n` opens the New Tag Modal. */
function tagSidebarKey(env: ShellEnv, input: string, delta: number): void {
  const { tagIndex, tags } = env.view;

  if (delta) {
    selectTag(env, Math.max(0, Math.min(tags.length, tagIndex + delta)));
  } else if (input === "n") {
    env.setOverlay({ kind: "newTag" });
  }
}

/** The keys of a Stage heading in the list: expand and collapse. */
function headingKey(env: ShellEnv, row: Extract<StoryListRow, { kind: "stage" }>, input: string, key: Key): void {
  if (key.return || input === " ") {
    fold(env, row.key, !row.collapsed);
  } else if (key.leftArrow || key.rightArrow) {
    fold(env, row.key, key.leftArrow);
  }
}

/** The keys of a Story in the list: start the range mode, open, delete, and collapse its section. */
function storyKey(env: ShellEnv, row: Extract<StoryListRow, { kind: "story" }>, input: string, key: Key): void {
  if (input === " ") {
    startRange(env, row.id);
  } else if (key.return) {
    editStory(env, row.story);
  } else if (input === "d") {
    env.setOverlay({ kind: "deleteStory", story: row.story });
  } else if (key.leftArrow && !env.view.stage) {
    collapseStory(env, row.story);
  }
}

/**
 * `shift+↑/↓` moves the selected Stories to the previous or next Stage. Without a selection, it moves the Story of
 * the cursor. In the range mode, it does nothing.
 */
function shiftKey(env: ShellEnv, shift: -1 | 1): void {
  const { row, ranging, marked } = env.view;

  if (ranging) {
    return;
  }

  if (marked.size > 0) {
    moveMarkedStories(env, shift);
  } else if (row?.kind === "story") {
    moveStoryStage(env, row.story, shift);
  }
}

/** The keys of the Story list. In the range mode, `space` ends the mode before the other keys. */
function listKey(env: ShellEnv, input: string, key: Key, delta: number, shift: -1 | 0 | 1): void {
  const { row, rows, cursor, ranging } = env.view;

  if (ranging && input === " ") {
    endRange(env);
  } else if (shift) {
    shiftKey(env, shift);
  } else if (delta) {
    selectStory(env, Math.max(0, Math.min(rows.length - 1, cursor + delta)));
  } else if (input === "n") {
    newStory(env);
  } else if (row?.kind === "stage") {
    headingKey(env, row, input, key);
  } else if (row?.kind === "story") {
    storyKey(env, row, input, key);
  }
}

/**
 * The panes that can take the focus, in the order of `tab`: the Stage sidebar, the tag sidebar, the Story list, the
 * Story sidebar. The Story list does not show while the Story sidebar is expanded, so it cannot take the focus.
 */
function paneOrder(view: ShellView, expanded: boolean): readonly Pane[] {
  const list = expanded && view.storyPane ? [] : (["stories"] as const);

  return [
    ...(view.sidebar ? (["stages"] as const) : []),
    ...(view.tagSidebar ? (["tags"] as const) : []),
    ...list,
    ...(view.storyPane ? (["story"] as const) : []),
  ];
}

/** The pane in focus. The Story list has the focus when no other pane has it. */
function focusedPane(view: ShellView): Pane {
  if (view.storyFocused) {
    return "story";
  }

  if (view.tagSidebarFocused) {
    return "tags";
  }

  return view.sidebarFocused ? "stages" : "stories";
}

/** The pane after the pane in focus (`tab`), or before it (`shift+tab`). The last pane goes back to the first. */
export function cyclePane(view: ShellView, step: 1 | -1, expanded = false): Pane {
  const order = paneOrder(view, expanded);
  const at = Math.max(0, order.indexOf(focusedPane(view)));

  return order[(at + step + order.length) % order.length] ?? "stories";
}

/**
 * `esc` gives the focus from the Stage sidebar or the tag sidebar to the Story list, or to an expanded Story sidebar that covers the
 * list. In the Story list, it ends the range mode or clears the multi-selection first. Then it closes the Story
 * sidebar.
 */
function escapeKey(env: ShellEnv): void {
  if (env.view.sidebarFocused || env.view.tagSidebarFocused) {
    env.setPane(listPane(env));
  } else if (env.view.mode === "stories" && hasMarks(env)) {
    clearMarks(env);
  } else if (env.view.storyPane) {
    requestStoryPane(env, null);
  }
}

/** The keys of the panes of an open Project: the focus, the Stage filter, then the keys of the pane in focus. */
function paneKey(env: ShellEnv, input: string, key: Key): void {
  const { sidebarFocused, tagSidebarFocused, stageIndex, stages } = env.view;
  const delta = moveDelta(input, key);
  const shift = reorderDelta(input, key);

  if (key.tab) {
    env.setPane(cyclePane(env.view, key.shift ? -1 : 1, env.storyExpanded));
  } else if (key.escape) {
    escapeKey(env);
  } else if (input === "[" || input === "]") {
    selectStage(env, (stageIndex + (input === "[" ? -1 : 1) + stages.length + 1) % (stages.length + 1));
  } else if (sidebarFocused) {
    sidebarKey(env, input, delta, shift);
  } else if (tagSidebarFocused) {
    tagSidebarKey(env, input, delta);
  } else if (env.view.mode === "stories") {
    // The Factory view takes its own keys.
    listKey(env, input, key, delta, shift);
  }
}

/** Routes a key of the shell. The `ctrl` keys come first, then the keys of the app, then the keys of a Project. */
export function handleShellKey(env: ShellEnv, input: string, key: Key): void {
  const { board, noProject } = env.view;
  const appOverlay = APP_OVERLAYS.get(input);
  const boardOverlay = BOARD_OVERLAYS.get(input);

  // The onboarding steps have no overlay around their text fields.
  if (noProject && env.registry.captured().text) {
    return;
  }

  if (key.ctrl || key.meta) {
    ctrlKey(env, input, key);
  } else if (input === "q") {
    env.exit();
  } else if (appOverlay) {
    env.setOverlay(appOverlay);
  } else if (!board) {
    return;
  } else if (boardOverlay) {
    env.setOverlay(boardOverlay);
  } else if (input === "t") {
    toggleMode(env);
  } else if (input === "c") {
    checksKey(env);
  } else {
    paneKey(env, input, key);
  }
}
