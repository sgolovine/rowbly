import { createContext, useContext, useEffect, useId, useSyncExternalStore } from 'react';
import type { KeyHint } from '../keymap';

/**
 * Shared state between the shell and the screens: who is capturing keys, which screens hold a
 * dirty form, and each screen's key hints. Screens are identified by their depth in the router stack.
 */
export interface ShellRegistry {
  /** Stops the shell from handling printable keys (and `esc` too when `escape` is set) until released. */
  capture(withEscape: boolean): () => void;
  captured(): { text: boolean; escape: boolean };
  setDirty(depth: number, id: string, dirty: boolean): void;
  /** Whether the screen at `depth` (or any screen when omitted) holds a dirty form. */
  isDirty(depth?: number): boolean;
  setHints(depth: number, hints: readonly KeyHint[] | null): void;
  hints(depth: number): readonly KeyHint[];
  subscribe(listener: () => void): () => void;
  /** Changes whenever the hints change. */
  version(): number;
}

export function createShellRegistry(): ShellRegistry {
  let text = 0;
  let escapes = 0;
  const dirty = new Map<string, number>();
  const hints = new Map<number, readonly KeyHint[]>();
  const listeners = new Set<() => void>();
  let version = 0;
  return {
    capture(withEscape) {
      text += 1;
      if (withEscape) escapes += 1;
      let released = false;
      return () => {
        if (released) return;
        released = true;
        text -= 1;
        if (withEscape) escapes -= 1;
      };
    },
    captured: () => ({ text: text > 0, escape: escapes > 0 }),
    setDirty(depth, id, isDirty) {
      if (isDirty) dirty.set(id, depth);
      else dirty.delete(id);
    },
    isDirty(depth) {
      for (const at of dirty.values()) if (depth === undefined || at === depth) return true;
      return false;
    },
    setHints(depth, next) {
      if (next) hints.set(depth, next);
      else hints.delete(depth);
      version += 1;
      for (const listener of listeners) listener();
    },
    hints: (depth) => hints.get(depth) ?? [],
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    version: () => version,
  };
}

export const ShellContext = createContext<ShellRegistry>(createShellRegistry());

/** False while an overlay is open or the screen is not on top of the router stack. */
export const ActiveContext = createContext(true);

/** The router-stack depth of the screen being rendered; `-1` outside any screen. */
export const ScreenDepthContext = createContext(-1);

/** Whether this part of the UI should handle keys right now. */
export function useIsActive(): boolean {
  return useContext(ActiveContext);
}

/** While `active`, the shell ignores printable keys (and `esc` when `escape` is set) so this component gets them. */
export function useKeyCapture(active: boolean, options: { escape?: boolean } = {}): void {
  const shell = useContext(ShellContext);
  const withEscape = options.escape ?? false;
  useEffect(() => (active ? shell.capture(withEscape) : undefined), [shell, active, withEscape]);
}

/** Marks the current screen as holding unsaved input, so `q` and `esc` ask before discarding it. */
export function useDirty(dirty: boolean): void {
  const shell = useContext(ShellContext);
  const depth = useContext(ScreenDepthContext);
  const id = useId();
  useEffect(() => {
    shell.setDirty(depth, id, dirty);
    return () => shell.setDirty(depth, id, false);
  }, [shell, depth, id, dirty]);
}

/** Sets the screen-specific key hints shown in the footer and the help overlay. */
export function useKeyHints(hints: readonly KeyHint[]): void {
  const shell = useContext(ShellContext);
  const depth = useContext(ScreenDepthContext);
  const key = JSON.stringify(hints);
  // biome-ignore lint/correctness/useExhaustiveDependencies: `key` stands in for `hints`, which callers usually rebuild each render.
  useEffect(() => {
    if (depth < 0) return;
    shell.setHints(depth, hints);
    return () => shell.setHints(depth, null);
  }, [shell, depth, key]);
}

/** The key hints of the screen at `depth`. */
export function useScreenHints(depth: number): readonly KeyHint[] {
  const shell = useContext(ShellContext);
  useSyncExternalStore(shell.subscribe, shell.version);
  return shell.hints(depth);
}
