import { createContext, useContext, useSyncExternalStore } from "react";
import { RowblyError } from "../../services/errors/errors.js";
import { Store, withMember, withoutMember } from "../../services/store/store.js";

type ToastKind = "info" | "warning" | "error";

export interface Toast {
  readonly id: number;
  readonly kind: ToastKind;
  readonly message: string;
  readonly pending?: boolean;
}

/** Holds the toasts on screen. Lives outside React so `ctx.warn` can feed it. */
export interface ToastStore {
  push(kind: ToastKind, message: string): void;
  pending(message: string): number;
  update(id: number, message: string): void;
  /** Shows any error as an error toast, with its hint when it is a `RowblyError`. */
  error(err: unknown): void;
  dismiss(id: number): void;
  list(): readonly Toast[];
  subscribe(listener: () => void): () => void;
}

/** At most this many toasts are shown; older ones drop off. */
const MAX_TOASTS = 3;

interface ToastState {
  /** The same array until the toasts change, as `useSyncExternalStore` needs. */
  readonly toasts: readonly Toast[];
  readonly nextId: number;
  readonly listeners: ReadonlySet<() => void>;
}

type ToastCell = Store<ToastState>;

/** The toasts to show: all pending toasts, and the newest regular toasts that fit next to them. */
function visibleToasts(next: readonly Toast[]): readonly Toast[] {
  const pendingCount = next.filter((toast) => toast.pending).length;
  const capacity = Math.max(0, MAX_TOASTS - pendingCount);
  const regular = new Set(capacity ? next.filter((toast) => !toast.pending).slice(-capacity) : []);

  return next.filter((toast) => toast.pending || regular.has(toast));
}

function setToasts(cell: ToastCell, next: readonly Toast[]): void {
  cell.update(() => ({ toasts: visibleToasts(next) }));

  for (const listener of cell.current.listeners) {
    listener();
  }
}

/** Takes the next free id. */
function takeId(cell: ToastCell): number {
  return cell.update((state) => ({ nextId: state.nextId + 1 })).nextId - 1;
}

function pushToast(cell: ToastCell, kind: ToastKind, message: string): void {
  setToasts(cell, [...cell.current.toasts, { id: takeId(cell), kind, message }]);
}

function pushPending(cell: ToastCell, message: string): number {
  const id = takeId(cell);

  setToasts(cell, [...cell.current.toasts, { id, kind: "info", message, pending: true }]);

  return id;
}

function updateToast(cell: ToastCell, id: number, message: string): void {
  setToasts(
    cell,
    cell.current.toasts.map((toast) => (toast.id === id ? { ...toast, message } : toast)),
  );
}

function dismissToast(cell: ToastCell, id: number): void {
  setToasts(
    cell,
    cell.current.toasts.filter((toast) => toast.id !== id),
  );
}

/** The text of an error toast: the message and the hint of a `RowblyError`, else an internal error. */
function errorMessage(err: unknown): string {
  if (err instanceof RowblyError) {
    return err.hint ? `${err.message} (${err.hint})` : err.message;
  }

  return `internal error: ${err instanceof Error ? err.message : String(err)}`;
}

function subscribe(cell: ToastCell, listener: () => void): () => void {
  cell.update((state) => ({ listeners: withMember(state.listeners, listener) }));

  return () => cell.update((state) => ({ listeners: withoutMember(state.listeners, listener) }));
}

/** Makes the store of the toasts on screen. */
export function createToastStore(): ToastStore {
  const cell = new Store<ToastState>({ toasts: [], nextId: 1, listeners: new Set() });

  return {
    push: (kind, message) => pushToast(cell, kind, message),
    pending: (message) => pushPending(cell, message),
    update: (id, message) => updateToast(cell, id, message),
    error: (err) => pushToast(cell, "error", errorMessage(err)),
    dismiss: (id) => dismissToast(cell, id),
    list: () => cell.current.toasts,
    subscribe: (listener) => subscribe(cell, listener),
  };
}

/**
 * Shows a toast through `toasts.push`. The name `push` matches the plugin for array changes, but the
 * store makes a new list for each toast.
 */
export function showToast(toasts: ToastStore, kind: ToastKind, message: string): void {
  // biome-ignore lint/plugin: `ToastStore.push` replaces the list in its store; it does not change an array.
  toasts.push(kind, message);
}

export const ToastContext = createContext<ToastStore>(createToastStore());

/** The shell's toast area: `useToast().error(err)` shows a failed service call without crashing. */
export function useToast(): ToastStore {
  return useContext(ToastContext);
}

/** The toasts currently on screen. */
export function useToasts(): readonly Toast[] {
  const store = useToast();

  return useSyncExternalStore(store.subscribe, store.list);
}
