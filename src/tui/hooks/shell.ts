import { createContext, type ReactNode, useContext, useEffect, useId, useSyncExternalStore } from 'react';
import type { ActionFocus } from '../../services';
import type { KeyHint } from '../keymap';

/** What a screen shows on the left of the header: a bold title and a dim detail after it. */
export interface HeaderLabel {
  title: string;
  detail?: string;
}

/**
 * Shared state between the shell and the screens: who is capturing keys, which screens hold a
 * dirty form, and each screen's key hints and header label. Screens are identified by their depth in the router stack.
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
  setLabel(depth: number, label: HeaderLabel | null): void;
  label(depth: number): HeaderLabel | null;
  /** What is in focus on the screen at `depth`, for Plugin Actions (ADR-0017). */
  setFocus(depth: number, focus: ActionFocus | null): void;
  focus(depth: number): ActionFocus | null;
  subscribe(listener: () => void): () => void;
  /** Changes whenever the hints or labels change. */
  version(): number;
}

export function createShellRegistry(): ShellRegistry {
  let text = 0;
  let escapes = 0;
  const dirty = new Map<string, number>();
  const hints = new Map<number, readonly KeyHint[]>();
  const labels = new Map<number, HeaderLabel>();
  const focuses = new Map<number, ActionFocus>();
  const listeners = new Set<() => void>();
  let version = 0;
  const changed = () => {
    version += 1;
    for (const listener of listeners) listener();
  };
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
      changed();
    },
    hints: (depth) => hints.get(depth) ?? [],
    setLabel(depth, label) {
      if (label) labels.set(depth, label);
      else labels.delete(depth);
      changed();
    },
    label: (depth) => labels.get(depth) ?? null,
    setFocus(depth, focus) {
      if (focus) focuses.set(depth, focus);
      else focuses.delete(depth);
      changed();
    },
    focus: (depth) => focuses.get(depth) ?? null,
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

/**
 * Shows a node, such as a full-screen editor, over the whole terminal. While it is open the
 * screens below it take no keys. `id` names the opener, so it closes only its own node.
 */
export interface MainOverlay {
  open(id: string, node: ReactNode): void;
  close(id: string): void;
}

/** `null` outside the shell, which has nothing to cover. */
export const MainOverlayContext = createContext<MainOverlay | null>(null);

export function useMainOverlay(): MainOverlay | null {
  return useContext(MainOverlayContext);
}

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

/**
 * Sets the label the header shows for the current screen. Only the root screen's label shows, so this
 * returns false for a screen in a modal, which should show the label itself.
 */
export function useHeaderLabel(label: HeaderLabel | null | undefined): boolean {
  const shell = useContext(ShellContext);
  const depth = useContext(ScreenDepthContext);
  const title = label?.title;
  const detail = label?.detail;
  useEffect(() => {
    if (depth < 0 || title === undefined) return;
    shell.setLabel(depth, { title, detail });
    return () => shell.setLabel(depth, null);
  }, [shell, depth, title, detail]);
  return depth === 0;
}

/** The header label of the screen at `depth`. */
export function useScreenLabel(depth: number): HeaderLabel | null {
  const shell = useContext(ShellContext);
  useSyncExternalStore(shell.subscribe, shell.version);
  return shell.label(depth);
}

/**
 * Declares the Board or Story in focus on the current screen, so the Plugin Actions that
 * target it show in the footer, the help and the header (ADR-0017).
 */
export function useActionFocus(focus: ActionFocus): void {
  const shell = useContext(ShellContext);
  const depth = useContext(ScreenDepthContext);
  const { board, story } = focus;
  const key = [board?.id, board?.updatedAt, story?.key, story?.updatedAt].join('|');
  // biome-ignore lint/correctness/useExhaustiveDependencies: `key` stands in for the focused records.
  useEffect(() => {
    if (depth < 0) return;
    shell.setFocus(depth, { board, story });
    return () => shell.setFocus(depth, null);
  }, [shell, depth, key]);
}

/** What is in focus on the screen at `depth`. */
export function useScreenFocus(depth: number): ActionFocus | null {
  const shell = useContext(ShellContext);
  useSyncExternalStore(shell.subscribe, shell.version);
  return shell.focus(depth);
}
