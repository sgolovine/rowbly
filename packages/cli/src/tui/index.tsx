import type { FactoryLaunch } from "../services/factory/factory.js";
import { App } from "./app.js";
import { createToastStore } from "./hooks/index.js";
import { runFullScreen } from "./terminal.js";

/** The options of the TUI from the CLI entry point. */
interface TuiOptions {
  /** How the Factory controls start the factory. */
  readonly launch?: FactoryLaunch;
  /** Imports the Pi SDK in the background after the board shows. */
  readonly preloadPi?: () => Promise<void>;
}

/** Runs the TUI full screen until the user quits. */
export async function renderTui(options: TuiOptions = {}): Promise<void> {
  const toasts = createToastStore();

  await runFullScreen(
    (mouse) => <App toasts={toasts} mouse={mouse} launch={options.launch} preloadPi={options.preloadPi} />,
    toasts,
  );
}
