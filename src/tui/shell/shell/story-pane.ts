import type { Story } from "../../../services/story/story.js";
import type { StoryPane } from "../overlay.js";
import type { Pane, ShellEnv } from "./shell-state.js";

/** Whether `a` and `b` show the same form: both closed, both a new Story, or the edit of the same Story. */
function samePane(a: StoryPane | null, b: StoryPane | null): boolean {
  if (a === null || b === null) {
    return a === b;
  }

  return a.kind === "new" ? b.kind === "new" : b.kind === "edit" && a.story.id === b.story.id;
}

/** The pane that has the focus after the Story sidebar shows `next`. A closed Story sidebar gives the focus to the list. */
function paneAfter(pane: Pane, next: StoryPane | null): Pane {
  if (next) {
    return "story";
  }

  return pane === "story" ? "stories" : pane;
}

/** Shows `next` in the Story sidebar and gives it the focus, or closes the Story sidebar with `null`. It does not ask. */
export function showStoryPane(env: ShellEnv, next: StoryPane | null): void {
  env.setStoryPane(next);
  env.setPane((pane) => paneAfter(pane, next));

  if (!next) {
    env.setStoryHints([]);
  }
}

/**
 * Shows `next` in the Story sidebar and gives it the focus, or closes the Story sidebar with `null`. When the
 * Story sidebar has unsaved text or images, Rowbly asks before it discards them. The form that is open already
 * only takes the focus.
 */
export function requestStoryPane(env: ShellEnv, next: StoryPane | null): void {
  const current = env.view.storyPane;

  if (samePane(current, next)) {
    showStoryPane(env, next);

    return;
  }

  if (current && env.registry.isDirty()) {
    env.setOverlay({ kind: "discardStory", next });

    return;
  }

  showStoryPane(env, next);
}

/** Opens the form of a new Story in the Story sidebar. */
export function newStory(env: ShellEnv): void {
  requestStoryPane(env, { kind: "new" });
}

/** Opens the edit form of the Story `story` in the Story sidebar. */
export function editStory(env: ShellEnv, story: Story): void {
  requestStoryPane(env, { kind: "edit", story });
}

/** The discard of the unsaved changes was confirmed: the Story sidebar shows `next`, or closes. */
export function discardStory(env: ShellEnv, next: StoryPane | null): void {
  env.setOverlay(null);
  showStoryPane(env, next);
}

/** Closes the Story sidebar when it edits the Story `id`, which is gone. */
export function closeDeletedStory(env: ShellEnv, id: string): void {
  const { storyPane } = env.view;

  if (storyPane?.kind === "edit" && storyPane.story.id === id) {
    showStoryPane(env, null);
  }
}
