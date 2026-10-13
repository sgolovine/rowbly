import { createContext, useContext, useSyncExternalStore } from 'react';
import { RowblyError } from '../../core';

export type ToastKind = 'info' | 'warning' | 'error';

export interface Toast {
  id: number;
  kind: ToastKind;
  message: string;
}

/** Holds the toasts on screen. Lives outside React so `ctx.warn` can feed it. */
export interface ToastStore {
  push(kind: ToastKind, message: string): void;
  /** Shows any error as an error toast, with its hint when it is a `RowblyError`. */
  error(err: unknown): void;
  dismiss(id: number): void;
  list(): readonly Toast[];
  subscribe(listener: () => void): () => void;
}

/** At most this many toasts are shown; older ones drop off. */
const MAX_TOASTS = 3;

export function createToastStore(): ToastStore {
  let toasts: readonly Toast[] = [];
  let nextId = 1;
  const listeners = new Set<() => void>();
  const set = (next: readonly Toast[]) => {
    toasts = next;
    for (const listener of listeners) listener();
  };
  const store: ToastStore = {
    push(kind, message) {
      set([...toasts, { id: nextId++, kind, message }].slice(-MAX_TOASTS));
    },
    error(err) {
      if (err instanceof RowblyError) {
        store.push('error', err.hint ? `${err.message} (${err.hint})` : err.message);
      } else {
        store.push('error', `internal error: ${err instanceof Error ? err.message : String(err)}`);
      }
    },
    dismiss(id) {
      set(toasts.filter((toast) => toast.id !== id));
    },
    list: () => toasts,
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
  return store;
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
