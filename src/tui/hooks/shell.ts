import { createContext, type ReactNode, useContext, useEffect, useId } from "react";
import { Store, withEntry, withoutEntry } from "../../services/store/store.js";
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
  readonly text: boolean;
  readonly escape: boolean;
}

interface HintPart {
  readonly hints: readonly KeyHint[];
  readonly lead: boolean;
}

interface ShellState {
  /** The number of captures that take printable keys and `esc`. */
  readonly text: number;
  readonly escapes: number;
  /** The depth of each screen part that holds a dirty form. */
  readonly dirty: ReadonlyMap<string, number>;
  readonly hints: ReadonlyMap<number, ReadonlyMap<string, HintPart>>;
}

type ShellStore = Store<ShellState>;

function captureKeys(store: ShellStore, keys: CaptureKeys): () => void {
  const capture = new Store({ released: false });

  store.update((state) => countCapture(state, keys, 1));

  return () => releaseKeys(store, capture, keys);
}

/** Releases a capture one time, also when the caller releases it again. */
function releaseKeys(store: ShellStore, capture: Store<{ released: boolean }>, keys: CaptureKeys): void {
  if (capture.current.released) {
    return;
  }

  capture.update(() => ({ released: true }));
  store.update((state) => countCapture(state, keys, -1));
}

function countCapture(state: ShellState, keys: CaptureKeys, step: 1 | -1): Partial<ShellState> {
  return {
    text: keys.text ? state.text + step : state.text,
    escapes: keys.escape ? state.escapes + step : state.escapes,
  };
}

function setDirty(store: ShellStore, depth: number, id: string, isDirty: boolean): void {
  store.update((state) => ({ dirty: isDirty ? withEntry(state.dirty, id, depth) : withoutEntry(state.dirty, id) }));
}

function isDirtyAt(state: ShellState, depth: number | undefined): boolean {
  return [...state.dirty.values()].some((at) => depth === undefined || at === depth);
}

/** The hint parts of each depth, with the part `id` at `depth` set, or removed with `null`. */
function withHintPart(
  hints: ShellState["hints"],
  depth: number,
  id: string,
  next: readonly KeyHint[] | null,
  lead: boolean,
): ShellState["hints"] {
  const parts = hints.get(depth) ?? new Map<string, HintPart>();
  const changed = next ? withEntry(parts, id, { hints: next, lead }) : withoutEntry(parts, id);

  return changed.size > 0 ? withEntry(hints, depth, changed) : withoutEntry(hints, depth);
}

function setHints(store: ShellStore, depth: number, id: string, next: readonly KeyHint[] | null, lead: boolean): void {
  store.update((state) => ({ hints: withHintPart(state.hints, depth, id, next, lead) }));
}

/** The hints of the screen at `depth`: the lead parts first. */
function hintsAt(state: ShellState, depth: number): readonly KeyHint[] {
  const parts = [...(state.hints.get(depth)?.values() ?? [])];

  return uniqueKeys([...parts.filter((p) => p.lead), ...parts.filter((p) => !p.lead)].flatMap((p) => p.hints));
}

/** Makes the registry that the shell and its screens share. */
export function createShellRegistry(): ShellRegistry {
  const store = new Store<ShellState>({ text: 0, escapes: 0, dirty: new Map(), hints: new Map() });

  return {
    capture: (keys) => captureKeys(store, keys),
    captured: () => ({ text: store.current.text > 0, escape: store.current.escapes > 0 }),
    setDirty: (depth, id, isDirty) => setDirty(store, depth, id, isDirty),
    isDirty: (depth) => isDirtyAt(store.current, depth),
    setHints: (depth, id, next, lead = false) => setHints(store, depth, id, next, lead),
    hints: (depth) => hintsAt(store.current, depth),
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

/** The overlay over the whole terminal, or `null` outside the shell. */
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
