import type { Stage } from "../../../services/stage/stage.js";
import { withMember, withoutMember } from "../../../services/store/store.js";
import type { Story } from "../../../services/story/story.js";
import { stageRowId } from "../../screens/stories/index.js";
import { ALL_STAGES, ALL_TAGS, type ShellEnv } from "./shell-state.js";
import { clearMarks } from "./story-marks.js";
import { editStory, listPane, showStoryPane } from "./story-pane.js";

/** Closes the overlay that is open. */
export function closeOverlay(env: ShellEnv): void {
  env.setOverlay(null);
}

/** Collapses or expands the section of the Stage `key` in All Stages. */
export function fold(env: ShellEnv, key: string, folded: boolean): void {
  env.setCollapsed((current) => (folded ? withMember(current, key) : withoutMember(current, key)));
}

/** Shows the Story `story` in the list: it leaves a Stage or tag filter that hides it and expands its section. */
function reveal(env: ShellEnv, story: Story): void {
  if (env.stageKey !== null && story.stage !== env.stageKey) {
    env.setStageKey(null);
  }

  if (env.tagKey !== null && !story.tags.includes(env.tagKey)) {
    env.setTagKey(null);
  }

  fold(env, story.stage, false);
  env.setSelectedId(story.id);
}

/** Selects the row at `index`. */
export function selectStory(env: ShellEnv, index: number): void {
  env.setSelectedId(env.view.rows[index]?.id ?? null);
}

/** Selects the sidebar entry at `index`. Entry 0 is All Stages. */
export function selectStage(env: ShellEnv, index: number): void {
  env.setStageKey(env.view.stages[index - 1]?.key ?? null);
}

/** Selects the sidebar entry `id`. */
export function filterStage(env: ShellEnv, id: string): void {
  env.setStageKey(id === ALL_STAGES ? null : id);
}

/** Selects the entry at `index` of the tag sidebar. Entry 0 is All Tags. */
export function selectTag(env: ShellEnv, index: number): void {
  env.setTagKey(env.view.tags[index - 1]?.value ?? null);
}

/** Selects the entry `id` of the tag sidebar. */
export function filterTag(env: ShellEnv, id: string): void {
  env.setTagKey(id === ALL_TAGS ? null : id);
}

/** Opens the Story at `index` for editing, or expands or collapses the section of the heading at `index`. */
function activateRow(env: ShellEnv, index: number): void {
  const at = env.view.rows[index];

  env.setSelectedId(at?.id ?? null);

  if (at?.kind === "stage") {
    fold(env, at.key, !at.collapsed);
  } else if (at?.kind === "story") {
    editStory(env, at.story);
  }
}

/** A click on a row of the list: the list takes the focus and the cursor goes to the row. */
export function pointRow(env: ShellEnv, index: number): void {
  env.setPane("stories");
  selectStory(env, index);
}

/** A second click on a row of the list, or a click on a heading. */
export function clickRow(env: ShellEnv, index: number): void {
  env.setPane("stories");
  activateRow(env, index);
}

/** `←` on a Story collapses its section and selects the heading. */
export function collapseStory(env: ShellEnv, story: Story): void {
  fold(env, story.stage, true);
  env.setSelectedId(stageRowId(story.stage));
}

/** Changes the right Panel between the Story list and the Factory view. */
export function toggleMode(env: ShellEnv): void {
  env.setMode((mode) => (mode === "stories" ? "threads" : "stories"));
}

/** Hides or shows the Stage sidebar and the tag sidebar. A hidden sidebar gives the focus to the list. */
export function toggleSidebar(env: ShellEnv): void {
  if (env.sidebarShown) {
    env.setPane(listPane(env));
  }

  env.setSidebarShown(!env.sidebarShown);
}

/** Opens the Stage of the filter for editing. */
export function editStage(env: ShellEnv): void {
  if (env.view.stage) {
    env.setOverlay({ kind: "editStage", stage: env.view.stage });
  }
}

/** Opens the Stage `key` for editing, from the sidebar. */
export function editStageByKey(env: ShellEnv, key: string): void {
  const edited = env.view.stages.find((s) => s.key === key);

  if (edited) {
    env.setOverlay({ kind: "editStage", stage: edited });
  }
}

/** Opens the Story `story` from the Story finder. */
export function openFoundStory(env: ShellEnv, story: Story): void {
  reveal(env, story);
  closeOverlay(env);
  editStory(env, story);
}

/**
 * Opens the Story `story` of a Thread, or of a click on the dependency lists of the edit form, in the Story sidebar:
 * the right Panel shows the Story list with the Story. Unsaved changes of the form get the discard confirmation.
 */
export function openThreadStory(env: ShellEnv, story: Story): void {
  env.setMode("stories");
  reveal(env, story);
  editStory(env, story);
}

/** Shows a Story that the Story sidebar created or saved, and closes the Story sidebar. */
export function showSavedStory(env: ShellEnv, story: Story): void {
  reveal(env, story);
  showStoryPane(env, null);
  env.putOnBoard(story);
}

/** Shows the Stories of a Stage that a Modal created or saved. */
export function showSavedStage(env: ShellEnv, stage: Stage): void {
  env.setStageKey(stage.key);
  closeOverlay(env);
  env.reload();
}

/** Opens the Project at `path`, with no filter or selection from the Project that was open. */
export function switchProject(env: ShellEnv, path: string): void {
  closeOverlay(env);

  if (path === env.view.board?.project.root) {
    return;
  }

  env.setCtx({ ...env.ctx, cwd: path });
  showStoryPane(env, null);
  env.setStageKey(null);
  env.setTagKey(null);
  env.setSelectedId(null);
  env.setCollapsed(new Set());
  clearMarks(env);
  env.setPane("stories");
}
