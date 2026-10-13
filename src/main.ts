import { homedir } from 'node:os';
import { Command, CommanderError } from 'commander';
import pkg from '../package.json' with { type: 'json' };
import { attachPlugins, PLUGIN_OPTION_COMMANDS, registerCommands } from './commands';
import { ExitCode, exitCodeFor, UsageError } from './core';
import { printError, printWarnings } from './output';
import {
  type AnyPluginDefinition,
  type DataRoot,
  failureWarning,
  loadPlugins,
  type PluginHost,
  type PluginOptionCommand,
  type ReservedNames,
} from './services';
import { findDataRoot } from './storage';
import { CORE_KEYS } from './tui/keymap';

/** The program with every core command, and the commands and options of the Plugins in `host`. */
export function createProgram(host?: PluginHost): Command {
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
  if (host) attachPlugins(program, host);
  return program;
}

/** The command names, options and keys that core uses, so that a Plugin cannot take them. */
export function reservedNames(): ReservedNames {
  const program = createProgram();
  const globals = program.options.map((o) => o.name());
  const options: Partial<Record<PluginOptionCommand, string[]>> = {};
  for (const path of PLUGIN_OPTION_COMMANDS) {
    const [group, verb] = path.split(' ');
    const command = program.commands.find((c) => c.name() === group)?.commands.find((c) => c.name() === verb);
    const names = (command?.options ?? []).map((o) => o.name().replace(/^no-/, ''));
    options[path] = [...new Set([...globals, ...names, 'help'])];
  }
  return { commands: [...program.commands.map((c) => c.name()), 'help'], options, keys: CORE_KEYS };
}

/** Prints any error thrown while running a command and returns the exit code (contracts §6). */
function handleError(err: unknown, json: boolean, registry: readonly AnyPluginDefinition[] = []): number {
  if (err instanceof CommanderError) {
    if (err.code === 'commander.helpDisplayed' || err.code === 'commander.version') return ExitCode.ok;
    // Help shown because a command group was run without a verb; it is already on stderr.
    if (err.code === 'commander.help') return ExitCode.usage;
    const plugin = registry.find((d) => err.message.includes(`unknown command '${d.id}'`));
    const hint = plugin ? `Plugin "${plugin.id}" is off; run \`rowbly plugins enable ${plugin.id}\`` : 'see --help';
    const usage = new UsageError(err.message.replace(/^error: /, ''), { hint });
    printError(usage, { json });
    return usage.exitCode;
  }
  printError(err, { json });
  return exitCodeFor(err);
}

/**
 * The global options when `argv` has no command, i.e. only `--root <path>`, `--json`, `--yes` and
 * `--no-prompt` (or nothing at all); otherwise `null`. `--help` and `--version` are left to commander.
 */
export function globalsOnly(argv: readonly string[]): { root?: string } | null {
  const globals: { root?: string } = {};
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i] as string;
    if (arg === '--json' || arg === '--yes' || arg === '--no-prompt') continue;
    if (arg.startsWith('--root=')) globals.root = arg.slice('--root='.length);
    else if (arg === '--root' && i + 1 < argv.length) globals.root = argv[++i];
    else return null;
  }
  return globals;
}

/** `--root <path>` or `--root=<path>` anywhere in `argv`. */
function rootFlag(argv: readonly string[]): string | undefined {
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i] as string;
    if (arg === '--') break;
    if (arg.startsWith('--root=')) return arg.slice('--root='.length);
    if (arg === '--root') return argv[i + 1];
  }
  return undefined;
}

/**
 * Runs Rowbly with the Plugins of `registry` and returns the exit code. The Plugins that the Data
 * Root turns on load first, because their commands and options are part of the program; each that
 * fails to load is skipped with one warning (ADR-0010).
 */
export async function main(argv: string[], registry: readonly AnyPluginDefinition[] = []): Promise<number> {
  const json = argv.includes('--json');
  const globals = globalsOnly(argv);
  const reserved = reservedNames();
  const load = (root: DataRoot | null) => loadPlugins({ root, registry, reserved });
  if (globals) {
    if (!(process.stdin.isTTY && process.stdout.isTTY)) {
      createProgram().outputHelp({ error: true });
      return ExitCode.usage;
    }
    try {
      // Loaded on demand: Ink and React take most of the start-up time of every other command.
      const { startTui } = await import('./tui');
      await startTui(undefined, { root: globals.root, loadPlugins: load });
      return ExitCode.ok;
    } catch (err) {
      return handleError(err, json);
    }
  }
  try {
    const root = await findDataRoot({
      cwd: process.cwd(),
      flag: rootFlag(argv),
      env: process.env,
      home: homedir(),
    }).catch(() => null);
    const host = await load(root);
    const program = createProgram(host);
    printWarnings(host.failures().map(failureWarning), { json });
    await program.parseAsync(argv, { from: 'user' });
    // A command may set its own exit code without throwing (e.g. `doctor` with errors).
    return Number(process.exitCode ?? ExitCode.ok);
  } catch (err) {
    return handleError(err, json, registry);
  }
}
