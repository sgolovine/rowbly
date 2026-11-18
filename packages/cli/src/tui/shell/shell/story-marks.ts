import type { ShellEnv } from "./shell-state.js";
import { storyIdsBetween } from "./shell-view.js";

/** No Story is in the multi-selection. */
const NO_MARKS: ReadonlySet<string> = new Set();

/** True when the Story list has a multi-selection or is in the range mode. */
export function hasMarks(env: ShellEnv): boolean {
  return env.view.ranging || env.view.marked.size > 0;
}

/** Ends the range mode and clears the multi-selection. */
export function clearMarks(env: ShellEnv): void {
  env.setAnchor(null);
  env.setMarked(NO_MARKS);
}

/** `space` on the Story `id` starts the range mode there. The range replaces the earlier selection. */
export function startRange(env: ShellEnv, id: string): void {
  env.setMarked(NO_MARKS);
  env.setAnchor(id);
}

/** `space` in the range mode ends the mode. The Story rows of the range stay selected. */
export function endRange(env: ShellEnv): void {
  env.setMarked(env.view.marked);
  env.setAnchor(null);
}

/** A `shift+click` on the row at `index` selects the Story rows from the cursor to it, and moves the cursor there. */
export function markRange(env: ShellEnv, index: number): void {
  const { rows, cursor } = env.view;

  env.setPane("stories");
  env.setAnchor(null);
  env.setMarked(new Set(storyIdsBetween(rows, cursor, index)));
  env.setSelectedId(rows[index]?.id ?? null);
}
