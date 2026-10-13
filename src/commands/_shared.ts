import { homedir } from 'node:os';
import { confirm, isCancel, select, text } from '@clack/prompts';
import type { Command } from 'commander';
import { UsageError } from '../core';
import { printWarnings } from '../output';
import type { RowblyContext, Services } from '../services';
import { createContext, createServices } from '../services';
import { editTextInEditor, readTextFile } from '../storage';

/** Global flags (contracts §5). */
export interface GlobalOptions {
  root?: string;
  json: boolean;
  yes: boolean;
  /** `false` with `--no-prompt`. */
  prompt: boolean;
}

export function globalOptions(cmd: Command): GlobalOptions {
  const opts = cmd.optsWithGlobals<Partial<GlobalOptions>>();
  return { root: opts.root, json: opts.json ?? false, yes: opts.yes ?? false, prompt: opts.prompt ?? true };
}

/** Prompting is allowed only with TTY stdin and stdout, and neither `--json` nor `--no-prompt`. */
export function isInteractive(globals: GlobalOptions): boolean {
  return Boolean(process.stdin.isTTY && process.stdout.isTTY) && !globals.json && globals.prompt;
}

/** `--workspace` / `--board` as parsed by commander. */
export interface ContextFlags {
  workspace?: string;
  board?: string;
}

/** The `flag` argument for `services.context.resolveWorkspace`: `--workspace` → `ROWBLY_WORKSPACE` (contracts §4). */
export function workspaceFlag(opts: ContextFlags, env: NodeJS.ProcessEnv = process.env): string | undefined {
  return opts.workspace || env.ROWBLY_WORKSPACE || undefined;
}

/**
 * The `flag` argument for `services.context.resolveBoard`: `--board` → `ROWBLY_BOARD` (contracts §4).
 * A bare board id is qualified with the Workspace from `workspaceFlag`, so `--workspace a --board b`
 * resolves `a/b`.
 */
export function boardFlag(opts: ContextFlags, env: NodeJS.ProcessEnv = process.env): string | undefined {
  const board = opts.board || env.ROWBLY_BOARD || undefined;
  const workspace = workspaceFlag(opts, env);
  if (board && workspace && !board.includes('/')) return `${workspace}/${board}`;
  return board;
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
      workspace: workspaceFlag(cmd.optsWithGlobals<ContextFlags>()),
      warn: (message) => warnings.push(message),
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

/**
 * Flattens a repeatable flag that may also be comma-separated: `['a,b', 'c']` → `['a', 'b', 'c']`.
 * Trims, drops empty entries and duplicates, and keeps first-seen order.
 */
export function parseRepeatable(values: string | readonly string[] | undefined): string[] {
  const list = typeof values === 'string' ? [values] : (values ?? []);
  const items = list.flatMap((value) => value.split(',')).map((item) => item.trim());
  return [...new Set(items.filter((item) => item !== ''))];
}

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
