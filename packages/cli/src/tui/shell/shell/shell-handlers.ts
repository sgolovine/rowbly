import type { RefObject } from "react";
import type { Stage } from "../../../services/stage/stage.js";
import type { Story } from "../../../services/story/story.js";
import type { ThreadRecord } from "../../../services/thread/thread.js";
import type { KeyHint } from "../../keymap.js";
import type { OverlayHandlers, SidePane } from "../overlay.js";
import type { StoryMenuAction } from "../story-menu/index.js";
import { cyclePane } from "./shell-keys.js";
import {
  clickRow,
  closeOverlay,
  editStageByKey,
  filterStage,
  filterTag,
  openFoundStory,
  openThreadStory,
  pointRow,
  showSavedStage,
  showSavedStory,
  showSavedTag,
  switchProject,
  toggleMode,
} from "./shell-selection.js";
import type { ShellEnv } from "./shell-state.js";
import { afterDelete, dropStory, moveStage, removeStory } from "./story-changes.js";
import { clearMarks, markRange } from "./story-marks.js";
import { openStoryMenu, runStoryAction } from "./story-menu-actions.js";
import {
  discardStory,
  leaveStoryPane,
  newStory,
  openOverlayThread,
  openThread,
  requestStoryPane,
  toggleStoryExpanded,
} from "./story-pane.js";

/** `tab` or `shift+tab` in a Thread of the Story sidebar moves the focus to the next or the previous pane. */
function tabPane(env: ShellEnv, step: 1 | -1): void {
  env.setPane(cyclePane(env.view, step, env.storyExpanded));
}

/** The handlers of the header. */
function headerHandlers(envRef: RefObject<ShellEnv>) {
  return {
    openProjects: () => envRef.current.setOverlay({ kind: "projects" }),
    openFinder: () => envRef.current.setOverlay({ kind: "finder" }),
    openFactory: () => envRef.current.setOverlay({ kind: "factory" }),
    openChecks: () => envRef.current.setOverlay({ kind: "checks" }),
    openSettings: () => envRef.current.setOverlay({ kind: "settings" }),
    toggleMode: () => toggleMode(envRef.current),
    newStory: () => newStory(envRef.current),
  };
}

/** The handlers of the Stage sidebar. */
function stageHandlers(envRef: RefObject<ShellEnv>) {
  return {
    focusStages: () => envRef.current.setPane("stages"),
    resizeStages: (width: number) => envRef.current.setSidebarWidth(width),
    filterStage: (id: string) => filterStage(envRef.current, id),
    editStage: (id: string) => editStageByKey(envRef.current, id),
    // A drop on All Stages moves the Stage to position 1.
    moveStage: (id: string, index: number) => moveStage(envRef.current, id, index),
    openNewStage: () => envRef.current.setOverlay({ kind: "newStage" }),
  };
}

/** The handlers of the tag sidebar. */
function tagHandlers(envRef: RefObject<ShellEnv>) {
  return {
    focusTags: () => envRef.current.setPane("tags"),
    filterTag: (id: string) => filterTag(envRef.current, id),
    resizeTags: (height: number) => envRef.current.setTagsHeight(height),
    openNewTag: () => envRef.current.setOverlay({ kind: "newTag" }),
  };
}

/** The handlers of the Story panel: the Story list, the Factory view and the onboarding steps. */
function panelHandlers(envRef: RefObject<ShellEnv>) {
  return {
    focusStories: () => envRef.current.setPane("stories"),
    pointRow: (index: number) => pointRow(envRef.current, index),
    dropStory: (id: string, gap: number) => dropStory(envRef.current, id, gap),
    clickRow: (index: number) => clickRow(envRef.current, index),
    markRange: (index: number) => markRange(envRef.current, index),
    clearMarks: () => clearMarks(envRef.current),
    openStoryMenu: (index: number, x: number, y: number) => openStoryMenu(envRef.current, index, x, y),
    openThread: (thread: ThreadRecord) => openThread(envRef.current, thread),
    threadHints: (hints: readonly KeyHint[]) => envRef.current.setThreadHints(hints),
    onboardingHints: (hints: readonly KeyHint[]) => envRef.current.setOnboardingHints(hints),
    reload: () => envRef.current.reload(),
  };
}

/** The handlers of the Story sidebar. */
function storyHandlers(envRef: RefObject<ShellEnv>) {
  return {
    focusStory: () => envRef.current.setPane("story"),
    resizeStory: (width: number) => envRef.current.setStoryWidth(width),
    toggleExpanded: () => toggleStoryExpanded(envRef.current),
    closeStory: () => requestStoryPane(envRef.current, null),
    leaveStory: () => leaveStoryPane(envRef.current),
    tabPane: (step: 1 | -1) => tabPane(envRef.current, step),
    savedStory: (saved: Story) => showSavedStory(envRef.current, saved),
    deletedStory: (id: string) => afterDelete(envRef.current, id),
    openStory: (opened: Story) => openThreadStory(envRef.current, opened),
    storyHints: (hints: readonly KeyHint[]) => envRef.current.setStoryHints(hints),
  };
}

/** What the overlays do when they close or change a record. */
function overlayHandlers(envRef: RefObject<ShellEnv>): OverlayHandlers {
  return {
    close: () => closeOverlay(envRef.current),
    openStory: (story: Story) => openFoundStory(envRef.current, story),
    openThread: (thread: ThreadRecord) => openOverlayThread(envRef.current, thread),
    discardStory: (next: SidePane | null) => discardStory(envRef.current, next),
    removeStory: (story: Story) => removeStory(envRef.current, story),
    storyAction: (action: StoryMenuAction, story: Story) => runStoryAction(envRef.current, action, story),
    stageSaved: (stage: Stage) => showSavedStage(envRef.current, stage),
    tagSaved: () => showSavedTag(envRef.current),
    openAiSettings: () => envRef.current.setOverlay({ kind: "settings", section: "ai" }),
    switchProject: (path: string) => switchProject(envRef.current, path),
    reload: () => envRef.current.reload(),
  };
}

/**
 * The handlers that the shell gives to its children. Each handler reads the env of the last render from `envRef`,
 * so the shell makes them one time and each one keeps its reference. Thus a memo child does not render again
 * because of a new handler.
 */
export function shellHandlers(envRef: RefObject<ShellEnv>) {
  return {
    ...headerHandlers(envRef),
    ...stageHandlers(envRef),
    ...tagHandlers(envRef),
    ...panelHandlers(envRef),
    ...storyHandlers(envRef),
    overlay: overlayHandlers(envRef),
  };
}

/** The stable handlers of the shell. */
export type ShellHandlers = ReturnType<typeof shellHandlers>;
