import { createContext, type ReactNode, useContext, useEffect, useId } from "react";
import type { KeyHint } from "../keymap.js";

/**
 * Shared state between the shell and the screens: who is capturing keys, which screens hold a
 * dirty form, and each screen's key hints. Screens are identified by their depth in the router stack.
 */
export interface ShellRegistry {
  /** Stops the shell from handling printable keys (when `text` is set) and `esc` (when `escape` is set) until released. */
  capture(keys: CaptureKeys): () => void;
  captured(): { text: boolean; escape: boolean };
  setDirty(depth: number, id: string, dirty: boolean): void;
  /** Whether the screen at `depth` (or any screen when omitted) holds a dirty form. */
  isDirty(depth?: number): boolean;
  /**
   * Sets the hints `id` adds to the screen at `depth`, or removes them with `null`. A `lead` part (a
   * Form's keys) comes before the screen's own; a key already shown is not repeated.
   */
  setHints(depth: number, id: string, hints: readonly KeyHint[] | null, lead?: boolean): void;
  hints(depth: number): readonly KeyHint[];
}

/** Which keys a capture takes from the shell. */
interface CaptureKeys {
  text: boolean;
  escape: boolean;
}

export function createShellRegistry(): ShellRegistry {
  let text = 0;
  let escapes = 0;
  const dirty = new Map<string, number>();
  const hints = new Map<number, Map<string, { hints: readonly KeyHint[]; lead: boolean }>>();
  return {
    capture(keys) {
      if (keys.text) {
        text += 1;
      }
      if (keys.escape) {
        escapes += 1;
      }
      let released = false;
      return () => {
        if (released) {
          return;
        }
        released = true;
        if (keys.text) {
          text -= 1;
        }
        if (keys.escape) {
          escapes -= 1;
        }
      };
    },
    captured: () => ({ text: text > 0, escape: escapes > 0 }),
    setDirty(depth, id, isDirty) {
      if (isDirty) {
        dirty.set(id, depth);
      } else {
        dirty.delete(id);
      }
    },
    isDirty(depth) {
      for (const at of dirty.values()) {
        if (depth === undefined || at === depth) {
          return true;
        }
      }
      return false;
    },
    setHints(depth, id, next, lead = false) {
      const parts = hints.get(depth) ?? new Map();
      if (next) {
        parts.set(id, { hints: next, lead });
      } else {
        parts.delete(id);
      }
      if (parts.size > 0) {
        hints.set(depth, parts);
      } else {
        hints.delete(depth);
      }
    },
    hints(depth) {
      const parts = [...(hints.get(depth)?.values() ?? [])];
      return uniqueKeys([...parts.filter((p) => p.lead), ...parts.filter((p) => !p.lead)].flatMap((p) => p.hints));
    },
  };
}

/** `hints` without the ones whose key an earlier hint already shows. */
export function uniqueKeys(hints: readonly KeyHint[]): KeyHint[] {
  return hints.filter((hint, i) => hints.findIndex((other) => other.key === hint.key) === i);
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

/**
 * While `active`, the shell ignores printable keys (unless `text` is false) and `esc` (when `escape` is
 * set) so this component gets them. `{ text: false, escape: true }` takes only `esc`, leaving letter keys
 * to the shell and to screens that check `captured().text`.
 */
export function useKeyCapture(active: boolean, options: { text?: boolean; escape?: boolean } = {}): void {
  const shell = useContext(ShellContext);
  const withText = options.text ?? true;
  const withEscape = options.escape ?? false;
  useEffect(
    () => (active ? shell.capture({ text: withText, escape: withEscape }) : undefined),
    [shell, active, withText, withEscape],
  );
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
  const id = useId();
  const key = JSON.stringify(hints);
  // biome-ignore lint/correctness/useExhaustiveDependencies: `key` stands in for `hints`, which callers usually rebuild each render.
  useEffect(() => {
    if (depth < 0) {
      return;
    }
    shell.setHints(depth, id, hints);
    return () => shell.setHints(depth, id, null);
  }, [shell, depth, id, key]);
}
