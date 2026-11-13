import type { ToastStore } from "../../hooks/index.js";

/** Shows an info toast. `ToastStore.push` adds a toast to the store; it does not change an array of the caller. */
export function toastInfo(toast: ToastStore, message: string): void {
  // biome-ignore lint/plugin: `push` is the method of the toast store, not of an array.
  toast.push("info", message);
}
