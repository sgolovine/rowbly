import type { Story } from "../../../services/story/story.js";
import type { ThreadRecord } from "../../../services/thread/thread.js";
import type { SidePane } from "../overlay.js";
import type { Pane, ShellEnv } from "./shell-state.js";

/** The id of the record that a pane shows: `new` for a new Story, else the id of the Story or the Thread. */
function paneId(pane: SidePane): string {
  if (pane.kind === "new") {
    return "new";
  }

  return pane.kind === "edit" ? `story:${pane.story.id}` : `thread:${pane.thread.id}`;
}

/** Whether `a` and `b` show the same thing: both closed, both a new Story, or the same Story or Thread. */
function samePane(a: SidePane | null, b: SidePane | null): boolean {
  if (a === null || b === null) {
    return a === b;
  }

  return paneId(a) === paneId(b);
}

/** The pane that has the focus after the Story sidebar shows `next`. A closed Story sidebar gives the focus to the list. */
function paneAfter(pane: Pane, next: SidePane | null): Pane {
  if (next) {
    return "story";
  }

  return pane === "story" ? "stories" : pane;
}

/** Shows `next` in the Story sidebar and gives it the focus, or closes the Story sidebar with `null`. It does not ask. */
export function showStoryPane(env: ShellEnv, next: SidePane | null): void {
  env.setStoryPane(next);
  env.setPane((pane) => paneAfter(pane, next));

  if (!next) {
    env.setStoryHints([]);
  }
}

/**
 * Shows `next` in the Story sidebar and gives it the focus, or closes the Story sidebar with `null`. When the
 * Story form has unsaved text or images, Rowbly asks before it discards them. A Thread is never dirty. The form
 * or the Thread that is open already only takes the focus.
 */
export function requestStoryPane(env: ShellEnv, next: SidePane | null): void {
  const current = env.view.storyPane;

  if (samePane(current, next)) {
    showStoryPane(env, next);

    return;
  }

  if (current && current.kind !== "thread" && env.registry.isDirty()) {
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

/** Shows the Thread `thread` in the Story sidebar, in place of a Story form. */
export function openThread(env: ShellEnv, thread: ThreadRecord): void {
  requestStoryPane(env, { kind: "thread", thread });
}

/** Closes the overlay, for example the Factory controls, and shows the Thread `thread` in the Story sidebar. */
export function openOverlayThread(env: ShellEnv, thread: ThreadRecord): void {
  env.setOverlay(null);
  openThread(env, thread);
}

/** The discard of the unsaved changes was confirmed: the Story sidebar shows `next`, or closes. */
export function discardStory(env: ShellEnv, next: SidePane | null): void {
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
