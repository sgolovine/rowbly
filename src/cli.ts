import { Command, CommanderError } from 'commander';
import pkg from '../package.json' with { type: 'json' };
import { registerCommands } from './commands';
import { ExitCode, exitCodeFor, UsageError } from './core';
import { printError } from './output';
import { startTui } from './tui';

export function createProgram(): Command {
  const program = new Command('rowbly')
    .description('A developer-focused, file-backed Kanban tracker.')
    .version(pkg.version, '-V, --version', 'output the version number')
    .option('--root <path>', 'use this Data Root instead of discovering one')
    .option('--json', 'machine-readable JSON output')
    .option('--yes', 'skip confirmations')
    .option('--no-prompt', 'never prompt; fail when input is missing')
    .configureHelp({ showGlobalOptions: true })
    // Errors are printed by `handleError`, which also maps them to exit codes.
    .configureOutput({ outputError: () => {} })
    .exitOverride();
  registerCommands(program);
  return program;
}

/** Prints any error thrown while running a command and returns the exit code (contracts §6). */
function handleError(err: unknown, json: boolean): number {
  if (err instanceof CommanderError) {
    if (err.code === 'commander.helpDisplayed' || err.code === 'commander.version') return ExitCode.ok;
    // Help shown because a command group was run without a verb; it is already on stderr.
    if (err.code === 'commander.help') return ExitCode.usage;
    const usage = new UsageError(err.message.replace(/^error: /, ''), { hint: 'see --help' });
    printError(usage, { json });
    return usage.exitCode;
  }
  printError(err, { json });
  return exitCodeFor(err);
}

export async function main(argv: string[]): Promise<number> {
  const program = createProgram();
  if (argv.length === 0) {
    if (process.stdin.isTTY && process.stdout.isTTY) {
      await startTui();
      return ExitCode.ok;
    }
    program.outputHelp({ error: true });
    return ExitCode.usage;
  }
  try {
    await program.parseAsync(argv, { from: 'user' });
    // A command may set its own exit code without throwing (e.g. `doctor` with errors).
    return Number(process.exitCode ?? ExitCode.ok);
  } catch (err) {
    return handleError(err, argv.includes('--json'));
  }
}

process.exitCode = await main(process.argv.slice(2));
