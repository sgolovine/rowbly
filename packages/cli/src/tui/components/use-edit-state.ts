import { type RefObject, useReducer, useRef } from "react";
import { writeRef } from "../hooks/index.js";
import type { EditState } from "./text-editing.js";

interface EditEnv {
  readonly latest: RefObject<EditState>;
  readonly rerender: () => void;
  readonly onChange: (value: string) => void;
}

/**
 * The state after the parent sets `value`. A cursor at the end stays there when the text is set from outside,
 * such as a key a Form fills from a name.
 */
function syncedState({ cursor, value: old }: EditState, value: string): EditState {
  return { value, cursor: cursor === old.length ? value.length : Math.min(cursor, value.length) };
}

/** Gives the `apply` function of one render. */
function editApplier(env: EditEnv): (next: EditState) => void {
  return (next) => applyEdit(env, next);
}

function applyEdit(env: EditEnv, next: EditState): void {
  const changed = next.value !== env.latest.current.value;

  writeRef(env.latest, next);
  env.rerender();

  if (changed) {
    env.onChange(next.value);
  }
}

/**
 * The text and caret of a controlled input. Keys are applied to the latest state rather than the last
 * render, so keys that arrive before a re-render (fast typing, held keys) all land. A `value` changed by
 * the parent replaces the text and keeps the caret within it.
 */
export function useEditState(value: string, onChange: (value: string) => void) {
  const latest = useRef<EditState>({ value, cursor: value.length });
  const [, rerender] = useReducer((n: number) => n + 1, 0);

  if (latest.current.value !== value) {
    writeRef(latest, syncedState(latest.current, value));
  }

  const apply = editApplier({ latest, rerender, onChange });

  return [latest.current, apply, latest] as const;
}
