import { Command, CommanderError, type OutputConfiguration } from "commander";
import { vi } from "vitest";
import { registerCommands } from "../register-commands/register-commands.js";

export interface CliResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

/** Builds the `rowbly` program as `src/cli.ts` does, but throws instead of exiting the process. */
export function createProgram(output: OutputConfiguration = {}): Command {
  // Subcommands copy these settings when they are registered.
  const program = new Command().name("rowbly").exitOverride().configureOutput(output);
  registerCommands(program);
  return program;
}

/**
 * Runs `rowbly <args>` in-process and captures what it prints. `cwd` is passed as `-C <cwd>` when
 * it is set. Output from Commander itself (usage errors, `--help`) is captured too.
 */
export async function runCli(args: string[], cwd?: string): Promise<CliResult> {
  const out: string[] = [];
  const err: string[] = [];
  const log = vi.spyOn(console, "log").mockImplementation((...parts: unknown[]) => void out.push(parts.join(" ")));
  const error = vi.spyOn(console, "error").mockImplementation((...parts: unknown[]) => void err.push(parts.join(" ")));
  const program = createProgram({
    writeOut: (text) => out.push(text.replace(/\n$/, "")),
    writeErr: (text) => err.push(text.replace(/\n$/, "")),
  });
  process.exitCode = undefined;
  let exitCode: number;
  try {
    await program.parseAsync([...(cwd ? ["-C", cwd] : []), ...args], { from: "user" });
    exitCode = Number(process.exitCode ?? 0);
  } catch (caught) {
    if (!(caught instanceof CommanderError)) {
      throw caught;
    }
    exitCode = caught.exitCode;
  } finally {
    process.exitCode = undefined;
    log.mockRestore();
    error.mockRestore();
  }
  return { stdout: out.join("\n"), stderr: err.join("\n"), exitCode };
}
