import { homedir } from 'node:os';
import { Command, CommanderError } from 'commander';
import pkg from '../package.json' with { type: 'json' };
import { attachPlugins, pluginCliStager, registerCommands } from './commands';
import { DataRootNotFoundError, ExitCode, exitCodeFor, UsageError } from './core';
import { printError, printWarnings } from './output';
import {
  type AnyPluginDefinition,
  type DataRoot,
  failureWarning,
  formatTrace,
  type LoadPluginsOptions,
  loadPlugins,
  PLUGIN_OPTION_COMMANDS,
  type PluginHost,
  type PluginOptionCommand,
  type ReservedNames,
  setTraceSink,
  traceBuffer,
  traceRequested,
} from './services';
import { drainGitQueue } from './services/plugins/git';
import { ensureHomeConfig, findDataRoot } from './storage';
import { CORE_KEYS } from './tui/keymap';

const DATA_ROOT_FLAG = '--data-root';

/** The program with every core command, and the commands and options of the Plugins in `host`. */
export function createProgram(host?: PluginHost): Command {
  const program = new Command('rowbly')
    .description('A developer-focused, file-backed Kanban tracker.')
    .version(pkg.version, '-V, --version', 'output the version number')
    .option('--data-root <path>', 'use this Data Root folder (the `.rowbly` folder itself)')
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

/**
 * The command names, options and keys that core uses, so that a Plugin cannot take them. They are
 * read from `program`, a core program to which no Plugin is attached yet.
 */
export function reservedNames(program: Command = createProgram()): ReservedNames {
  // Both polarities of an option share one name: `--no-prompt` reserves `--prompt` too (RES-25).
  const base = (options: readonly { name(): string }[]) => options.map((o) => o.name().replace(/^no-/, ''));
  const globals = base(program.options);
  const options: Partial<Record<PluginOptionCommand, string[]>> = {};
  for (const path of PLUGIN_OPTION_COMMANDS) {
    const [group, verb] = path.split(' ');
    const command = program.commands.find((c) => c.name() === group)?.commands.find((c) => c.name() === verb);
    options[path] = [...new Set([...globals, ...base(command?.options ?? []), 'help'])];
  }
  return { commands: [...program.commands.map((c) => c.name()), 'help'], options, keys: CORE_KEYS };
}

/**
 * Builds the core program once, loads the Plugins that `root` turns on with their CLI part staged
 * against it, and attaches the complete part of each Plugin that loaded (PERF-06, ARCH-24).
 */
export async function loadProgram(
  root: DataRoot | null,
  registry: readonly AnyPluginDefinition[],
): Promise<{ program: Command; host: PluginHost }> {
  const program = createProgram();
  const cli = pluginCliStager(program);
  const host = await loadPlugins({ root, registry, reserved: reservedNames(program), stage: cli.stage });
  cli.attach(host);
  return { program, host };
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
 * The global options when `argv` has no command, i.e. only `--data-root <path>`, `--json`, `--yes` and
 * `--no-prompt` (or nothing at all); otherwise `null`. `--help` and `--version` are left to commander.
 */
export function globalsOnly(argv: readonly string[]): { root?: string } | null {
  const globals: { root?: string } = {};
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i] as string;
    if (arg === '--json' || arg === '--yes' || arg === '--no-prompt') continue;
    if (arg.startsWith(`${DATA_ROOT_FLAG}=`)) globals.root = arg.slice(DATA_ROOT_FLAG.length + 1);
    else if (arg === DATA_ROOT_FLAG && i + 1 < argv.length) globals.root = argv[++i];
    else return null;
  }
  return globals;
}

/**
 * Whether `argv` only asks for the version: exactly one `--version` or `-V`, and otherwise only
 * global options, in any order. Rowbly then answers without loading Plugins (ARCH-28).
 */
export function versionOnly(argv: readonly string[]): boolean {
  const flags = argv.flatMap((arg, i) =>
    (arg === '--version' || arg === '-V') && argv[i - 1] !== DATA_ROOT_FLAG ? [i] : [],
  );
  if (flags.length !== 1) return false;
  return globalsOnly(argv.filter((_, i) => i !== flags[0])) !== null;
}

/**
 * `--data-root <path>` or `--data-root=<path>` anywhere in `argv`, as commander reads it, so that the
 * Plugins loaded before parsing are those of the Data Root the command opens.
 */
function rootFlag(argv: readonly string[]): string | undefined {
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i] as string;
    if (arg === '--') break;
    if (arg.startsWith(`${DATA_ROOT_FLAG}=`)) return arg.slice(DATA_ROOT_FLAG.length + 1);
    if (arg === DATA_ROOT_FLAG) return argv[i + 1];
  }
  return undefined;
}

/** Commander's error for a command or option that the program does not have. */
function unknownName(err: unknown): boolean {
  return (
    err instanceof CommanderError && (err.code === 'commander.unknownCommand' || err.code === 'commander.unknownOption')
  );
}

/**
 * Runs Rowbly with the Plugins of `registry` and returns the exit code. The Plugins that the Data
 * Root turns on load first, because their commands and options are part of the program; each that
 * fails to load is skipped with one warning (ADR-0010).
 */
export async function main(argv: string[], registry: readonly AnyPluginDefinition[] = []): Promise<number> {
  const json = argv.includes('--json');
  // Every run makes sure `~/.rowblyrc.json` exists (ADR-0031 §1). Best effort: a home folder that
  // cannot be written must not stop a command that does not need it.
  await ensureHomeConfig(homedir()).catch(() => undefined);
  if (versionOnly(argv)) {
    try {
      await createProgram().parseAsync(argv, { from: 'user' });
      return ExitCode.ok;
    } catch (err) {
      return handleError(err, json);
    }
  }
  const globals = globalsOnly(argv);
  if (globals) {
    const reserved = reservedNames();
    const load = (root: DataRoot | null, stage?: LoadPluginsOptions['stage']) =>
      loadPlugins({ root, registry, reserved, stage });
    if (!(process.stdin.isTTY && process.stdout.isTTY)) {
      createProgram().outputHelp({ error: true });
      return ExitCode.usage;
    }
    // Ink owns the terminal: the trace waits in a bounded buffer and goes to stderr on exit (OBS-01).
    const buffer = traceRequested(process.env) ? traceBuffer() : undefined;
    setTraceSink(buffer?.sink);
    try {
      // Loaded on demand: Ink and React take most of the start-up time of every other command.
      const { startTui } = await import('./tui');
      await startTui(undefined, { root: globals.root, loadPlugins: load });
      return ExitCode.ok;
    } catch (err) {
      return handleError(err, json);
    } finally {
      setTraceSink(undefined);
      for (const line of buffer?.lines() ?? []) process.stderr.write(`${line}\n`);
    }
  }
  // Each event goes to stderr as it happens, so `--json` output on stdout stays parseable (OBS-01).
  setTraceSink(traceRequested(process.env) ? (event) => process.stderr.write(`${formatTrace(event)}\n`) : undefined);
  // Why the Data Root could not be opened, other than finding none: a Plugin command or option is
  // unknown then because no Plugin loaded, so that is the error to report (ADR-0033 §1).
  let preload: unknown;
  try {
    // The same resolution as the command's own context, so the Plugins loaded are the ones of the
    // Data Root it opens. A failure loads none here; the command reports it when it needs the root.
    const root = await findDataRoot({
      cwd: process.cwd(),
      flag: rootFlag(argv),
      env: process.env,
      home: homedir(),
    }).catch((err: unknown) => {
      if (!(err instanceof DataRootNotFoundError && err.details.path === undefined)) preload = err;
      return null;
    });
    const { program, host } = await loadProgram(root, registry);
    printWarnings(host.failures().map(failureWarning), { json });
    await program.parseAsync(argv, { from: 'user' });
    // A command may set its own exit code without throwing (e.g. `doctor` with errors).
    return Number(process.exitCode ?? ExitCode.ok);
  } catch (err) {
    return handleError(preload !== undefined && unknownName(err) ? preload : err, json, registry);
  } finally {
    await drainGitQueue();
    setTraceSink(undefined);
  }
}
