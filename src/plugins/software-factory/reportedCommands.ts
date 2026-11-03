import {
  ConflictError,
  DataIntegrityError,
  NotFoundError,
  type PluginCommandEnv,
  type RowblyError,
  renderTable,
  UsageError,
  ValidationError,
} from '../../plugin-api';
import { currentRun, formatRunRef, type StageRun } from './stageRuns';

/**
 * What `software-factory apply` does with one line of a worker's reported block (ADR-0045):
 * `apply` runs it, `hold` keeps a move until the Stage Run is finished, `drop` skips a move after a
 * failed Stage Run, `reject` refuses the whole block.
 */
export type Decision = 'apply' | 'hold' | 'drop' | 'reject';

export interface ReportedCommand {
  /** The line's number in the text given, from 1. */
  line: number;
  text: string;
  /** The command's arguments after `rowbly`, as it runs; `null` when the line cannot be read. */
  argv: string[] | null;
  decision: Decision;
  reason?: string;
  /** Set once the command ran. */
  exitCode?: number;
  output?: unknown;
}

export interface ApplyResult {
  key: string;
  stageRun: StageRun | null;
  dryRun: boolean;
  commands: ReportedCommand[];
}

/**
 * The lines to read: those inside ```` ```rowbly ```` fences when the text has any, else every line.
 * Blank lines are skipped.
 */
export function blockLines(text: string): { line: number; text: string }[] {
  const lines = text.split(/\r?\n/).map((t, i) => ({ line: i + 1, text: t.trim() }));
  const fenced = lines.some((l) => /^```rowbly$/.test(l.text));
  const kept: { line: number; text: string }[] = [];
  let inside = false;
  for (const l of lines) {
    if (fenced && /^```/.test(l.text)) {
      inside = !inside && l.text === '```rowbly';
      continue;
    }
    if ((!fenced || inside) && l.text) kept.push(l);
  }
  return kept;
}

/** Characters a shell would treat as syntax when unquoted. */
const SHELL_SYNTAX = new Set([...';|&<>()$`*?[]{}~#!']);

/**
 * Splits one line into arguments with POSIX quoting (`'…'`, `"…"`, `\`), without a shell. Anything a
 * shell would expand or run, unquoted or inside double quotes, is an error: the line means one thing.
 */
export function tokenize(line: string): string[] {
  const args: string[] = [];
  let current = '';
  let started = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i] as string;
    if (c === ' ' || c === '\t') {
      if (started) args.push(current);
      current = '';
      started = false;
    } else if (c === "'") {
      const end = line.indexOf("'", i + 1);
      if (end < 0) throw new Error('a single quote is not closed');
      current += line.slice(i + 1, end);
      started = true;
      i = end;
    } else if (c === '"') {
      started = true;
      for (i++; ; i++) {
        const d = line[i];
        if (d === undefined) throw new Error('a double quote is not closed');
        if (d === '"') break;
        if (d === '$' || d === '`') throw new Error(`"${d}" inside double quotes; use single quotes`);
        if (d === '\\' && ['"', '\\', '$', '`'].includes(line[i + 1] ?? '')) current += line[++i];
        else current += d;
      }
    } else if (c === '\\') {
      const next = line[++i];
      if (next === undefined) throw new Error('a line cannot end with "\\"');
      current += next;
      started = true;
    } else if (SHELL_SYNTAX.has(c)) {
      throw new Error(`shell syntax "${c}"; quote it`);
    } else {
      current += c;
      started = true;
    }
  }
  if (started) args.push(current);
  return args;
}

/** Where a command names its Story: its first argument, a Task id's prefix, or `--story`. */
type KeyAt = 'first' | 'task' | 'story-option';

/**
 * The commands a worker may report, each writing its own Story only (ADR-0045 §1). `refuse` lists
 * options that would write another Story: Story Linking stores a link on the blocking Story.
 */
const ALLOWED: Record<string, { keyAt: KeyAt; move?: true; refuse?: string[] }> = {
  'stories edit': { keyAt: 'first' },
  'stories move': { keyAt: 'first', move: true },
  'comments add': { keyAt: 'first' },
  'comments edit': { keyAt: 'first' },
  'tasks create': { keyAt: 'first' },
  'tasks edit': { keyAt: 'task' },
  'tasks move': { keyAt: 'task' },
  'specs create': { keyAt: 'story-option' },
  'specs edit': { keyAt: 'story-option' },
  'story-linking add': { keyAt: 'first', refuse: ['--blocked-by'] },
  'story-linking remove': { keyAt: 'first', refuse: ['--blocked-by'] },
};

/** Options the supervisor sets itself, or that read files or open an editor on its computer. */
const REFUSED_OPTIONS = new Set([
  '--data-root',
  '--board',
  '--yes',
  '--prompt',
  '--edit',
  '--help',
  '--version',
  '--story-spec',
  '--from-clipboard',
  '--finished-run',
]);
/** Options added to every command anyway, dropped when a worker gives them. */
const PINNED_OPTIONS = new Set(['--json', '--no-prompt']);

/**
 * Checks one reported command, `argv` after `rowbly`, against the allowlist for Story `key`.
 * Returns the arguments to run, with the Story's own key as stored, or why it is refused.
 */
export function checkCommand(argv: string[], key: string): { args: string[]; move: boolean } | { reason: string } {
  const path = argv.slice(0, 2).join(' ');
  if (argv[0] === 'software-factory') return { reason: 'Stage Runs are changed by the supervisor only' };
  const rule = ALLOWED[path];
  if (!rule) return { reason: `"rowbly ${path}" is not a command a worker may report` };
  const args: string[] = [];
  let story: string | undefined;
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i] as string;
    const name = arg.split('=')[0] as string;
    if (PINNED_OPTIONS.has(arg)) continue;
    if (arg === '--' || (arg.startsWith('-') && !arg.startsWith('--')))
      return { reason: `option "${arg}" is not allowed; use long options` };
    if (REFUSED_OPTIONS.has(name) || name.endsWith('-file'))
      return { reason: `option "${name}" is not allowed in a reported command` };
    if (rule.refuse?.includes(name)) return { reason: `option "${name}" writes the other Story, not ${key}` };
    if (rule.keyAt === 'story-option' && name === '--story') {
      if (story !== undefined) return { reason: '"--story" is given twice' };
      story = arg.includes('=') ? arg.slice(arg.indexOf('=') + 1) : argv[i + 1];
      if (story?.toUpperCase() !== key) return { reason: `it is about ${story ?? 'no Story'}, not ${key}` };
      args.push('--story', key);
      if (!arg.includes('=')) i++;
      continue;
    }
    args.push(arg);
  }
  if (rule.keyAt === 'story-option') {
    if (story === undefined) return { reason: `it needs --story ${key}` };
  } else {
    const target = args[2];
    const own =
      rule.keyAt === 'task'
        ? target?.toUpperCase().startsWith(`${key}.`) && /^\d+$/.test(target.slice(key.length + 1))
        : target?.toUpperCase() === key;
    if (!own) return { reason: `it is about ${target ?? 'no Story'}, not ${key}` };
    args[2] = rule.keyAt === 'task' ? `${key}${(target as string).slice(key.length)}` : key;
  }
  return { args, move: !!rule.move };
}

/**
 * Decides every line of a reported block for Story `key`, whose current Stage Run is `run`. A move
 * runs only once the Stage Run is finished: it is held while it runs or is absent, and dropped
 * after it failed (ADR-0045 §2). An applied move names that Stage Run with `--finished-run`, so its
 * own operation refuses it when the Run changed since. Moves run last; a block holds at most one.
 */
export function planBlock(text: string, key: string, run: StageRun | null): ReportedCommand[] {
  const planned: ReportedCommand[] = [];
  let moves = 0;
  for (const { line, text: lineText } of blockLines(text)) {
    let argv: string[];
    try {
      argv = tokenize(lineText);
    } catch (err) {
      planned.push({ line, text: lineText, argv: null, decision: 'reject', reason: (err as Error).message });
      continue;
    }
    if (argv[0] !== 'rowbly') {
      planned.push({ line, text: lineText, argv: null, decision: 'reject', reason: 'it is not a rowbly command' });
      continue;
    }
    const checked = checkCommand(argv.slice(1), key);
    if ('reason' in checked) {
      planned.push({ line, text: lineText, argv: argv.slice(1), decision: 'reject', reason: checked.reason });
    } else if (checked.move && ++moves > 1) {
      planned.push({
        line,
        text: lineText,
        argv: checked.args,
        decision: 'reject',
        reason: 'a block moves the Story once',
      });
    } else if (checked.move) {
      const status = run?.status;
      const decision: Decision = status === 'finished' ? 'apply' : status === 'failed' ? 'drop' : 'hold';
      const reason =
        decision === 'apply'
          ? undefined
          : decision === 'drop'
            ? 'the Stage Run failed, so the Story stays in its Stage'
            : `held until the Stage Run is finished (${status ? 'it is running' : 'there is none'})`;
      const argv = run && decision === 'apply' ? [...checked.args, '--finished-run', formatRunRef(run)] : checked.args;
      planned.push({ line, text: lineText, argv, decision, ...(reason ? { reason } : {}) });
    } else {
      planned.push({ line, text: lineText, argv: checked.args, decision: 'apply' });
    }
  }
  // Moves last, so the Story's other changes land in the Stage the worker worked it in.
  return [...planned.filter((c) => !isMove(c)), ...planned.filter(isMove)];
}

function isMove(c: ReportedCommand): boolean {
  return c.decision !== 'reject' && c.argv?.[0] === 'stories' && c.argv[1] === 'move';
}

const ERRORS: Record<string, new (message: string, options?: { details?: Record<string, unknown> }) => RowblyError> = {
  USAGE: UsageError,
  VALIDATION: ValidationError,
  NOT_FOUND: NotFoundError,
  CONFLICT: ConflictError,
  DATA_INTEGRITY: DataIntegrityError,
};

function errorOf(output: unknown): { code?: string; message?: string } {
  return (output as { error?: { code?: string; message?: string } } | null)?.error ?? {};
}

/**
 * `software-factory apply`: plans the block, refuses it whole when any line is rejected, and
 * otherwise runs each `apply` line in order through the CLI, one child command per line. A line that
 * fails stops the block; the lines before it stay applied, and the error lists every line's outcome.
 */
export async function applyBlock(
  env: Pick<PluginCommandEnv<unknown>, 'plugin' | 'runCommand'>,
  key: string,
  text: string,
  dryRun: boolean,
): Promise<ApplyResult> {
  const story = await env.plugin.services.stories.get(key);
  const stageRun = currentRun(env.plugin, story);
  const commands = planBlock(text, story.key, stageRun);
  const result: ApplyResult = { key: story.key, stageRun, dryRun, commands };
  if (!commands.length) throw new UsageError('The block has no rowbly command');
  const rejected = commands.filter((c) => c.decision === 'reject');
  if (rejected.length)
    throw new UsageError(
      `Refused the block: ${rejected.map((c) => `line ${c.line}: ${c.reason}`).join('; ')}. Nothing was applied`,
      { details: { ...result } },
    );
  if (dryRun) return result;
  for (const command of commands) {
    if (command.decision !== 'apply') continue;
    const { exitCode, output } = await env.runCommand(command.argv as string[]);
    command.exitCode = exitCode;
    command.output = output;
    if (exitCode !== 0) {
      const error = errorOf(output);
      const applied = commands.filter((c) => c.exitCode === 0).map((c) => c.line);
      const Err = ERRORS[error.code ?? ''] ?? ConflictError;
      throw new Err(
        `Line ${command.line} failed: ${error.message ?? `exit ${exitCode}`}. ${
          applied.length === 1
            ? `Line ${applied[0]} was applied`
            : applied.length
              ? `Lines ${applied.join(', ')} were applied`
              : 'No line was applied'
        }; the lines after it were not run`,
        { details: { ...result } },
      );
    }
  }
  return result;
}

/** An argument as a reported line would write it: single-quoted unless it is plain. */
function quote(arg: string): string {
  return /^[\w@%+=:,./-]+$/.test(arg) ? arg : `'${arg.replaceAll("'", `'\\''`)}'`;
}

/** The human output of `apply`: one row per line, in the order they run, and what is held. */
export function applyTable(result: ApplyResult): string {
  const head = result.dryRun ? `Dry run for ${result.key}; nothing was changed` : `Applied the block for ${result.key}`;
  const rows = result.commands.map((c) => [
    String(c.line),
    result.dryRun || c.decision !== 'apply' ? c.decision : 'applied',
    c.argv ? ['rowbly', ...c.argv].map(quote).join(' ') : c.text,
    c.reason ?? '',
  ]);
  const held = result.commands.filter((c) => c.decision === 'hold').length;
  const note = held ? `\nApply the held move again once the Stage Run is finished.` : '';
  return `${head}\n${renderTable(['Line', 'Decision', 'Command', 'Reason'], rows)}${note}`;
}
