import { Command, CommanderError, type OutputConfiguration } from "commander";
import { type MockInstance, vi } from "vitest";
import { Store } from "../../services/store/store.js";
import { setExitCode } from "../output/output.js";
import { registerCommands } from "../register-commands/register-commands.js";

export interface CliResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

/** The lines that one run printed, by stream. */
interface Captured {
  readonly out: readonly string[];
  readonly err: readonly string[];
}

/** Builds the `rowbly` program as `src/cli.ts` does, but throws instead of exiting the process. */
export function createProgram(output: OutputConfiguration = {}): Command {
  // Subcommands copy these settings when they are registered.
  const program = new Command().name("rowbly").exitOverride().configureOutput(output);

  registerCommands(program);

  return program;
}

function capture(captured: Store<Captured>, stream: keyof Captured, line: string): void {
  captured.update((current) => ({ [stream]: [...current[stream], line] }));
}

/** Runs the program and gives its exit code. A Commander error, for example a usage error, gives its own code. */
async function parseExitCode(program: Command, argv: readonly string[]): Promise<number> {
  try {
    await program.parseAsync([...argv], { from: "user" });

    return Number(process.exitCode ?? 0);
  } catch (caught) {
    if (!(caught instanceof CommanderError)) {
      throw caught;
    }

    return caught.exitCode;
  }
}

function restoreConsole(log: MockInstance, error: MockInstance): void {
  setExitCode(undefined);
  log.mockRestore();
  error.mockRestore();
}

/**
 * Runs `rowbly <args>` in-process and captures what it prints. `cwd` is passed as `-C <cwd>` when
 * it is set. Output from Commander itself (usage errors, `--help`) is captured too.
 */
export async function runCli(args: string[], cwd?: string): Promise<CliResult> {
  const captured = new Store<Captured>({ out: [], err: [] });
  const log = vi
    .spyOn(console, "log")
    .mockImplementation((...parts: unknown[]) => capture(captured, "out", parts.join(" ")));
  const error = vi
    .spyOn(console, "error")
    .mockImplementation((...parts: unknown[]) => capture(captured, "err", parts.join(" ")));
  const program = createProgram({
    writeOut: (text) => capture(captured, "out", text.replace(/\n$/, "")),
    writeErr: (text) => capture(captured, "err", text.replace(/\n$/, "")),
  });

  setExitCode(undefined);

  const exitCode = await parseExitCode(program, [...(cwd ? ["-C", cwd] : []), ...args]).finally(() =>
    restoreConsole(log, error),
  );

  return { stdout: captured.current.out.join("\n"), stderr: captured.current.err.join("\n"), exitCode };
}
