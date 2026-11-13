import type { FactoryLaunch } from "../services/factory/factory.js";
import { App } from "./app.js";
import { createToastStore } from "./hooks/index.js";
import { runFullScreen } from "./terminal.js";

/** Runs the TUI full screen until the user quits. `launch` tells the Factory controls how to start the factory. */
export async function renderTui(options: { launch?: FactoryLaunch } = {}): Promise<void> {
  const toasts = createToastStore();

  await runFullScreen((mouse) => <App toasts={toasts} mouse={mouse} launch={options.launch} />, toasts);
}
