import { App } from "./App.js";
import { createToastStore } from "./hooks/index.js";
import { runFullScreen } from "./terminal.js";

/** Runs the TUI full screen until the user quits. */
export async function renderTui(): Promise<void> {
  const toasts = createToastStore();
  await runFullScreen((mouse) => <App toasts={toasts} mouse={mouse} />, toasts);
}
