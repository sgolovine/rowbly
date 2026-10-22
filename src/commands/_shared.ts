import { homedir } from 'node:os';
import { confirm, isCancel, select, text } from '@clack/prompts';
import type { Command } from 'commander';
import { UsageError } from '../core';
import { printWarnings } from '../output';
import type { PluginHost, PluginInput, PluginOptionValues, RowblyContext, Services } from '../services';
import { createContext, createServices, invokePluginSync } from '../services';
import { editTextInEditor, readTextFile } from '../storage';

/** Global flags (contracts §5). */
export interface GlobalOptions {
  /** `--data-root`. */
  root?: string;
  json: boolean;
  yes: boolean;
  /** `false` with `--no-prompt`. */
  prompt: boolean;
}

export function globalOptions(cmd: Command): GlobalOptions {
  const opts = cmd.optsWithGlobals<{ dataRoot?: string; json?: boolean; yes?: boolean; prompt?: boolean }>();
  return { root: opts.dataRoot, json: opts.json ?? false, yes: opts.yes ?? false, prompt: opts.prompt ?? true };
}

/** Prompting is allowed only with TTY stdin and stdout, and neither `--json` nor `--no-prompt`. */
export function isInteractive(globals: GlobalOptions): boolean {
  return Boolean(process.stdin.isTTY && process.stdout.isTTY) && !globals.json && globals.prompt;
}

/** `--board` as parsed by commander. */
export interface ContextFlags {
  board?: string;
}

/** The `flag` argument for `services.context.resolveBoard`: `--board` → `ROWBLY_BOARD` (contracts §4). */
export function boardFlag(opts: ContextFlags, env: NodeJS.ProcessEnv = process.env): string | undefined {
  return opts.board || env.ROWBLY_BOARD || undefined;
}

/** One Plugin's options on one core command. */
export interface AttachedPluginOptions {
  id: string;
  /** The Commander attribute names of its options, e.g. `epic`. */
  attributes: string[];
  /** Its `input` (operation input) or, on `stories list`, its `filter` (criteria). */
  convert(values: PluginOptionValues): unknown;
}

/** The Plugins of a program: their host, and which of them add options to each core command. */
export interface ProgramPlugins {
  host: PluginHost;
  options: Map<string, AttachedPluginOptions[]>;
}

const programPlugins = new WeakMap<Command, ProgramPlugins>();

export function setProgramPlugins(program: Command, plugins: ProgramPlugins): void {
  programPlugins.set(program, plugins);
}

/** The Plugins of the program `cmd` belongs to. */
export function pluginsOf(cmd: Command): ProgramPlugins | undefined {
  let root = cmd;
  while (root.parent) root = root.parent;
  return programPlugins.get(root);
}

/** A command's path below the program, e.g. `stories create`. */
export function commandPath(cmd: Command): string {
  const names: string[] = [];
  for (let at: Command | null = cmd; at?.parent; at = at.parent) names.unshift(at.name());
  return names.join(' ');
}

/**
 * The Plugin input that the Plugins' options on `cmd` give (ADR-0012): `{ <id>: … }`, or
 * `undefined` when none was used. Only options given on the command line have a value, so a lone
 * `--no-x` that was not used gives `undefined` rather than Commander's default `true` (DX-10). With
 * both `--x` and `--no-x`, the last one wins.
 */
export function pluginInput(cmd: Command): PluginInput | undefined {
  // Plugin options are long flags, optionally repeatable, so Commander gives only these value types.
  const opts = cmd.opts<PluginOptionValues>();
  const given = (name: string) => (cmd.getOptionValueSource(name) === 'cli' ? opts[name] : undefined);
  const input: PluginInput = {};
  for (const { id, attributes, convert } of pluginsOf(cmd)?.options.get(commandPath(cmd)) ?? []) {
    const values: PluginOptionValues = Object.fromEntries(attributes.map((name) => [name, given(name)]));
    const value = invokePluginSync({ plugin: id, stage: 'option-input' }, () => convert(values));
    if (value !== undefined) input[id] = value;
  }
  return Object.keys(input).length > 0 ? input : undefined;
}

/** `{ plugins }` for an operation's options, or `{}` when no Plugin option was used. */
export function pluginOptions(cmd: Command): { plugins?: PluginInput } {
  const plugins = pluginInput(cmd);
  return plugins ? { plugins } : {};
}

export interface CommandEnv {
  ctx: RowblyContext;
  services: Services;
  globals: GlobalOptions;
}

/**
 * Resolves the Data Root, Local State and Me, builds the `RowblyContext` and services, and runs
 * `fn`. Warnings collected through `ctx.warn` are printed afterwards, even when `fn` throws.
 */
export async function withContext<T>(cmd: Command, fn: (env: CommandEnv) => Promise<T>): Promise<T> {
  const globals = globalOptions(cmd);
  const warnings: string[] = [];
  try {
    const ctx = await createContext({
      cwd: process.cwd(),
      env: process.env,
      home: homedir(),
      root: globals.root,
      warn: (message) => warnings.push(message),
      plugins: pluginsOf(cmd)?.host,
    });
    return await fn({ ctx, services: createServices(ctx), globals });
  } finally {
    printWarnings(warnings, { json: globals.json });
  }
}

function cancelled(): never {
  throw new UsageError('cancelled');
}

export interface PromptSpec<T extends string> {
  /** The flag or argument the value would come from, used in the error, e.g. `--name`. */
  flag: string;
  message: string;
  /** Offer a choice instead of free text. */
  options?: { value: T; label?: string; hint?: string }[];
  /** Returns an error message for invalid free text. */
  validate?: (value: string) => string | undefined;
  initialValue?: string;
}

/**
 * Returns `value` when given. Otherwise asks for it through Clack when interactive, or throws a
 * `UsageError` naming the missing flag.
 */
export async function promptIfMissing<T extends string>(
  value: T | undefined,
  globals: GlobalOptions,
  spec: PromptSpec<T>,
): Promise<T> {
  if (value !== undefined) return value;
  if (!isInteractive(globals)) throw new UsageError(`missing required ${spec.flag}`);
  if (spec.options) {
    const answer = await select<T>({
      message: spec.message,
      options: spec.options as Parameters<typeof select<T>>[0]['options'],
    });
    return isCancel(answer) ? cancelled() : answer;
  }
  const answer = await text({
    message: spec.message,
    initialValue: spec.initialValue,
    validate: (input) => (input ? spec.validate?.(input) : `${spec.flag} is required`),
  });
  return isCancel(answer) ? cancelled() : (answer as T);
}

/**
 * Asks before a destructive action. `--yes` skips the question; when not interactive, `--yes` is
 * required. Declining throws a `UsageError`.
 */
export async function confirmDestructive(message: string, globals: GlobalOptions): Promise<void> {
  if (globals.yes) return;
  if (!isInteractive(globals)) {
    throw new UsageError(`${message} — confirmation required`, { hint: 'pass --yes to confirm' });
  }
  const answer = await confirm({ message, initialValue: false });
  if (isCancel(answer) || !answer) cancelled();
}

export interface LongTextFlags {
  /** `--description` / `--body`. */
  text?: string;
  /** `--description-file` / `--body-file`: a path, or `-` for stdin. */
  file?: string;
  /** `--edit`: open `$VISUAL`/`$EDITOR`. */
  edit?: boolean;
}

/**
 * Reads long text from exactly one of its three sources, or returns `undefined` when none is given.
 * `initial` seeds the editor. File and editor input loses trailing whitespace.
 */
export async function readLongText(
  flags: LongTextFlags,
  { name, initial = '', stdin = process.stdin }: { name: string; initial?: string; stdin?: NodeJS.ReadableStream },
): Promise<string | undefined> {
  const given = [flags.text !== undefined, flags.file !== undefined, Boolean(flags.edit)].filter(Boolean).length;
  if (given > 1) throw new UsageError(`use only one of --${name}, --${name}-file and --edit`);
  if (flags.text !== undefined) return flags.text;
  if (flags.file === '-') return (await readStream(stdin)).trimEnd();
  if (flags.file !== undefined) return (await readTextFile(flags.file)).trimEnd();
  if (flags.edit) return (await editTextInEditor(initial)).trimEnd();
  return undefined;
}

async function readStream(stream: NodeJS.ReadableStream): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of stream) chunks.push(typeof chunk === 'string' ? Buffer.from(chunk) : chunk);
  return Buffer.concat(chunks).toString('utf8');
}

export { parseRepeatable } from '../core';

/** Commander argument parser that collects every occurrence of a repeatable flag. */
export function collect(value: string, previous: string[] = []): string[] {
  return [...previous, value];
}

/**
 * Parses `--field key=value` occurrences into raw string values. Occurrences may be comma-separated;
 * a comma-separated segment without `=` continues the previous value, so multiselect values work:
 * `['size=3,tags=a,b']` → `{ size: '3', tags: 'a,b' }`. Services coerce the strings by field type.
 */
export function parseFieldAssignments(values: readonly string[] | undefined): Record<string, string> {
  const result: Record<string, string> = {};
  for (const value of values ?? []) {
    let currentKey: string | undefined;
    for (const segment of value.split(',')) {
      const eq = segment.indexOf('=');
      if (eq === -1) {
        if (currentKey === undefined)
          throw new UsageError(`invalid --field "${value}"`, { hint: 'expected key=value' });
        result[currentKey] = `${result[currentKey]},${segment}`;
        continue;
      }
      currentKey = segment.slice(0, eq).trim();
      if (currentKey === '') throw new UsageError(`invalid --field "${value}"`, { hint: 'expected key=value' });
      result[currentKey] = segment.slice(eq + 1).trim();
    }
  }
  return result;
}
