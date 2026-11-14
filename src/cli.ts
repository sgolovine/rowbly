import { resolve } from "node:path";
import { Command } from "commander";
import pkg from "../package.json" with { type: "json" };
import { registerCommands } from "./commands/register-commands/register-commands.js";

const program = new Command().name("rowbly").description(pkg.description).version(pkg.version, "-v, --version");

registerCommands(program);

/** Imports the Pi SDK in the background. The dynamic import keeps the CLI commands free of Pi. */
async function preloadPiSdk(): Promise<void> {
  const { preloadPi } = await import("./services/pi-runtime/pi-runtime.js");

  await preloadPi();
}

// `rowbly` with no arguments launches the TUI; anything else is a CLI invocation.
if (process.argv.length <= 2) {
  // Load the TUI only here, so that CLI commands do not load Ink, React or the TUI screens.
  const { renderTui } = await import("./tui/index.js");

  // The Factory controls start the factory with the same Node, loader flags and entry file as this process.
  await renderTui({
    launch: {
      executable: process.execPath,
      execArgv: [...process.execArgv],
      entry: resolve(process.argv[1] as string),
    },
    // Only the TUI imports Pi early, after the board shows. The CLI commands stay free of Pi.
    preloadPi: preloadPiSdk,
  });
} else {
  await program.parseAsync(process.argv);
}
