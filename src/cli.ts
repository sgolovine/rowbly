import { Command } from "commander";
import pkg from "../package.json" with { type: "json" };
import { registerCommands } from "./commands/registerCommands/registerCommands.js";
import { renderTui } from "./tui/index.js";

const program = new Command().name("rowbly").description(pkg.description).version(pkg.version, "-v, --version");

registerCommands(program);

// `rowbly` with no arguments launches the TUI; anything else is a CLI invocation.
if (process.argv.length <= 2) {
  await renderTui();
} else {
  await program.parseAsync(process.argv);
}
