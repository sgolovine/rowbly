import { type PluginCommands, renderTable, UsageError } from '../../plugin-api';
import { holdStory, holdText, releaseStory } from './holds';
import { applyBlock, applyTable } from './reportedCommands';
import {
  boardOverview,
  type Level,
  levelOverview,
  parseLevel,
  removeStagePrompt,
  rowLine,
  type StagePrompt,
  type StagePromptsOverview,
  setStagePrompt,
  showStagePrompt,
} from './stagePrompts';
import {
  clearRun,
  endRun,
  type RunsOverview,
  runsOverview,
  runText,
  type StageRunResult,
  startRun,
  type WaitResult,
  waitForRuns,
} from './stageRuns';
import { type AttachWorker, attachWorker } from './workerIdentity';

interface PromptOptions {
  board?: string;
  level?: string;
  text?: string;
  file?: string;
  edit?: boolean;
}

const HEAD = ['Stage', 'Name', 'Stage Prompt', 'Source', 'Path'];

function table(overview: StagePromptsOverview): string {
  return renderTable(HEAD, overview.stages.map(rowLine));
}

function runLine(result: StageRunResult): string {
  return `Stage Run of ${result.key} in ${result.stageRun.stage}: ${runText(result.stageRun)}`;
}

function runsTable(overview: RunsOverview): string {
  const digest = `Digest: ${overview.digest}`;
  if (!overview.stages.length) return `No Stage Prompt is on for Board ${overview.board}\n${digest}`;
  const table = renderTable(
    ['Story', 'Stage', 'Stage Run', 'Verified worker', 'Eligibility', 'Name'],
    overview.stories.map((s) => [
      s.key,
      s.stage,
      runText(s.stageRun),
      s.runMetadata.identity
        ? `${s.runMetadata.identity.machine} / ${s.runMetadata.identity.harness} / ${s.runMetadata.identity.threadId}`
        : s.runMetadata.status === 'invalid' || s.runMetadata.status === 'unsupported'
          ? 'unavailable'
          : 'not recorded',
      s.eligibility.reasons.map((r) => r.message).join('; ') || 'Eligible',
      s.name,
    ]),
  );
  return `${table}\n${digest}`;
}

function waitText(result: WaitResult): string {
  return `${result.changed ? 'Changed' : 'No change before the timeout'}\n${runsTable(result)}`;
}

/** The longest `--timeout`: a longer timer would fire at once. */
const MAX_TIMEOUT_SECONDS = 2_147_483;

function parseTimeout(value: string | undefined): number | undefined {
  if (value === undefined) return undefined;
  const seconds = Number(value);
  if (!/^\d+(\.\d+)?$/.test(value.trim()) || seconds > MAX_TIMEOUT_SECONDS)
    throw new UsageError(`--timeout takes a number of seconds from 0 to ${MAX_TIMEOUT_SECONDS}`);
  return seconds;
}

function promptLine(stage: string, prompt: StagePrompt): string {
  return `Stage Prompt ${stage}: ${prompt.enabled ? 'on' : prompt.configured ? 'on, but its file is missing' : 'off'}${prompt.path ? ` (${prompt.path})` : ''}`;
}

export const commands: PluginCommands = (group, cli) => {
  group
    .command('stages')
    .description("List the Board's Stages with their Stage Prompts, on or off, and the prompt text")
    .option('--board <id>', 'the Board')
    .option('--level <level>', 'board or global: show one level alone instead of the effective Stage Prompts')
    .action((opts: PromptOptions, cmd) =>
      cli.run(cmd, async ({ plugin, print, resolveBoard }) => {
        const level = parseLevel(opts.level);
        const overview =
          level === 'global'
            ? await levelOverview(plugin, 'global', undefined)
            : level === 'board'
              ? await levelOverview(plugin, 'board', await resolveBoard(opts.board))
              : await boardOverview(plugin, await resolveBoard(opts.board));
        print(overview, table);
      }),
    );

  const prompt = group.command('prompt').description("Show, turn on or off, edit or remove a Stage's Stage Prompt");
  const verbs = {
    show: 'Show the Stage Prompt of a Stage: the effective one on the Board, or one level with --level',
    enable: 'Turn a Stage Prompt on, creating its Markdown file from a template when it has none',
    disable: 'Turn a Stage Prompt off; its file is kept',
    edit: 'Replace the text of a Stage Prompt, creating its file when it has none',
    remove: 'Remove a Stage Prompt at one level, with its file',
  } as const;
  for (const [verb, description] of Object.entries(verbs) as [keyof typeof verbs, string][]) {
    const command = prompt
      .command(`${verb} <stage>`)
      .description(description)
      .option('--board <id>', 'the Board')
      .option(
        '--level <level>',
        verb === 'show' ? 'board or global; without it, the effective Stage Prompt' : 'board (default) or global',
      );
    if (verb === 'edit') {
      command
        .option('--text <text>', 'markdown text')
        .option('--file <path|->', 'read markdown from a file or stdin')
        .option('--edit', 'open $VISUAL or $EDITOR');
    }
    command.action((stage: string, opts: PromptOptions, cmd) =>
      cli.run(cmd, async (env) => {
        const { plugin, print } = env;
        const level = parseLevel(opts.level);
        if (level === 'global' && opts.board) throw new UsageError('Use --board only with the board level');
        const board = level === 'global' ? undefined : await env.resolveBoard(opts.board);
        if (verb === 'show') {
          const row = await showStagePrompt(plugin, board, stage, level);
          print(row, (r) => `${promptLine(r.key, r.prompt)}${r.prompt.text !== null ? `\n\n${r.prompt.text}` : ''}`);
          return;
        }
        const target = { level: level ?? ('board' as Level), board, stage };
        if (verb === 'remove') {
          await env.confirm(`Remove the Stage Prompt of Stage "${stage}" at the ${target.level} level, with its file?`);
          print(await removeStagePrompt(plugin, target), (r) => `Removed Stage Prompt ${r.removed}`);
          return;
        }
        if (verb === 'edit') {
          if ([opts.text !== undefined, opts.file !== undefined, !!opts.edit].filter(Boolean).length > 1)
            throw new UsageError('Use only one of --text, --file and --edit');
          const text = opts.edit
            ? await env.editText((await showStagePrompt(plugin, board, stage, target.level)).prompt.text ?? '')
            : await env.readText({ text: opts.text, file: opts.file }, { name: 'text' });
          if (text === undefined) throw new UsageError('Give the text with --text, --file or --edit');
          const saved = await setStagePrompt(plugin, target, { text });
          print(saved, (p) => `Edited ${promptLine(stage, p)}`);
          return;
        }
        const saved = await setStagePrompt(plugin, target, { enabled: verb === 'enable' });
        print(saved, (p) => promptLine(stage, p));
      }),
    );
  }

  group
    .command('runs')
    .description('List the Stories in Stages whose Stage Prompt is on, with their Stage Runs')
    .option('--board <id>', 'the Board')
    .action((opts: { board?: string }, cmd) =>
      cli.run(cmd, async ({ plugin, print, resolveBoard }) => {
        print(await runsOverview(plugin, await resolveBoard(opts.board)), runsTable);
      }),
    );

  group
    .command('hold <story>')
    .description('Hold a Story, so no Stage Run starts for it until it is released')
    .requiredOption('--reason <text>', 'why it is held, shown wherever the hold is')
    .action((key: string, opts: { reason: string }, cmd) =>
      cli.run(cmd, async ({ plugin, print }) => {
        print(
          await holdStory(plugin, key, { reason: opts.reason }),
          (r) => `${r.key} is ${holdText({ kind: 'held', hold: r.hold })}`,
        );
      }),
    );
  group
    .command('release <story>')
    .description('Release a held Story, so Stage Runs start for it again; its Stage Run is kept')
    .action((key: string, _opts: unknown, cmd) =>
      cli.run(cmd, async ({ plugin, print }) => {
        print(await releaseStory(plugin, key), (r) => `Released ${r.key}`);
      }),
    );

  group
    .command('wait')
    .description(
      'Wait until the Stories in Stages whose Stage Prompt is on, or their Stage Runs, change; then list them as runs does',
    )
    .option('--board <id>', 'the Board')
    .option('--since <digest>', 'the digest of the runs last read; without it, the runs when the wait starts')
    .option('--timeout <seconds>', 'stop waiting after this many seconds, with nothing changed')
    .action((opts: { board?: string; since?: string; timeout?: string }, cmd) =>
      cli.run(cmd, async ({ plugin, print, resolveBoard, waitFor }) => {
        const timeout = parseTimeout(opts.timeout);
        const board = await resolveBoard(opts.board);
        const signal = timeout === undefined ? undefined : AbortSignal.timeout(timeout * 1000);
        print(await waitForRuns(plugin, board, waitFor, { since: opts.since?.trim() || undefined, signal }), waitText);
      }),
    );

  const run = group.command('run').description("Start, attach a worker to, finish, fail or clear a Story's Stage Run");
  run
    .command('start <story>')
    .description("Start a Stage Run on the Story's current Stage, whose Stage Prompt must be on")
    .requiredOption('--worker <name>', 'the agent or thread that works the Story')
    .option('--retry', 'start a failed Stage Run again, as its next attempt')
    .action((key: string, opts: { worker: string; retry?: boolean }, cmd) =>
      cli.run(cmd, async ({ plugin, print }) => {
        print(await startRun(plugin, key, { worker: opts.worker, retry: opts.retry }), runLine);
      }),
    );
  run
    .command('attach <story>')
    .description('Attach the actual worker identity with supervisor attestation of launch verification')
    .requiredOption('--stage <stage>', 'expected Stage Run Stage')
    .requiredOption('--attempt <number>', 'expected Stage Run attempt', Number)
    .requiredOption('--started-at <timestamp>', 'expected Stage Run start time')
    .requiredOption('--worker <id>', 'actual worker identifier')
    .requiredOption('--machine <name>', 'machine on which the worker can be found')
    .requiredOption('--harness <name>', 'harness that owns the worker thread')
    .requiredOption('--thread-id <id>', 'actual harness thread identifier')
    .requiredOption('--source <text>', 'source of the supervisor verification, such as a launch receipt')
    .action((key: string, opts: AttachWorker, cmd) =>
      cli.run(cmd, async ({ plugin, print }) => {
        print(
          await attachWorker(plugin, key, opts),
          (r) =>
            `${runLine(r)}\nVerified worker: ${r.identity.machine} / ${r.identity.harness} / ${r.identity.threadId}`,
        );
      }),
    );
  run
    .command('finish <story>')
    .description("Mark the Story's running Stage Run finished")
    .action((key: string, _opts: unknown, cmd) =>
      cli.run(cmd, async ({ plugin, print }) => {
        print(await endRun(plugin, key, { status: 'finished' }), runLine);
      }),
    );
  run
    .command('fail <story>')
    .description("Mark the Story's running Stage Run failed")
    .option('--reason <text>', 'why it failed')
    .action((key: string, opts: { reason?: string }, cmd) =>
      cli.run(cmd, async ({ plugin, print }) => {
        print(await endRun(plugin, key, { status: 'failed', reason: opts.reason }), runLine);
      }),
    );
  run
    .command('clear <story>')
    .description("Remove the Story's Stage Run, so its Stage is worked again")
    .action((key: string, _opts: unknown, cmd) =>
      cli.run(cmd, async ({ plugin, print }) => {
        print(await clearRun(plugin, key), (r) => `Cleared the Stage Run of ${r.cleared}`);
      }),
    );

  group
    .command('apply <story>')
    .description("Check a worker's reported rowbly block for its Story, then run the commands it allows")
    .option('--text <block>', 'the block, or the message holding it')
    .option('--file <path|->', 'read the block from a file or stdin')
    .option('--dry-run', 'only check the block and show what each line would do')
    .action((key: string, opts: { text?: string; file?: string; dryRun?: boolean }, cmd) =>
      cli.run(cmd, async (env) => {
        const text = await env.readText({ text: opts.text, file: opts.file }, { name: 'text' });
        if (text === undefined) throw new UsageError('Give the block with --text or --file');
        env.print(await applyBlock(env, key, text, !!opts.dryRun), applyTable);
      }),
    );
};
