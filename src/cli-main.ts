import { resolve } from "node:path";
import { Command } from "commander";
import pkg from "../package.json" with { type: "json" };
import { registerCommands } from "./commands/register-commands/register-commands.js";
import { loadInProductionMode } from "./services/react-mode/react-mode.js";

const program = new Command().name("rowbly").description(pkg.description).version(pkg.version, "-v, --version");

registerCommands(program);

/**
 * Starts the Pi worker in the background, so that it imports the Pi SDK off the render thread. The dynamic import
 * keeps the CLI commands free of the worker client.
 */
async function preloadPiSdk(): Promise<void> {
  const { warmPiWorker } = await import("./services/pi-runtime/pi-worker-client.js");

  await warmPiWorker();
}

/** Terminates the Pi worker when the TUI quits. */
async function stopPiWorkerThread(): Promise<void> {
  const { stopPiWorker } = await import("./services/pi-runtime/pi-worker-client.js");

  await stopPiWorker();
}

// `rowbly` with no arguments launches the TUI; anything else is a CLI invocation.
if (process.argv.length <= 2) {
  // Load the TUI only here, so that CLI commands do not load Ink, React or the TUI screens. React loads its
  // production bundles, unless the user set `NODE_ENV`.
  const { renderTui } = await loadInProductionMode(() => import("./tui/index.js"));

  // The Factory controls start the factory with the same Node, loader flags and entry file as this process.
  await renderTui({
    launch: {
      executable: process.execPath,
      execArgv: [...process.execArgv],
      entry: resolve(process.argv[1] as string),
    },
    // Only the TUI starts the Pi worker early, after the board shows. The CLI commands stay free of Pi.
    preloadPi: preloadPiSdk,
  });
  await stopPiWorkerThread();
} else {
  await program.parseAsync(process.argv);
}
