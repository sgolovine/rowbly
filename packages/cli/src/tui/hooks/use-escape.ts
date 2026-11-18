import { type Key, useInput } from "ink";

function escapeKey(key: Key, onEscape: () => void): void {
  if (key.escape) {
    onEscape();
  }
}

/** Cancels the open form or dialog on `esc` instead of leaving the screen. */
export function useEscape(active: boolean, onEscape: () => void): void {
  useInput((_input, key) => escapeKey(key, onEscape), { isActive: active });
}
