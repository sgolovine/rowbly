import { type PluginCommands, renderTable, UsageError } from '../../plugin-api';
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
import { clearRun, endRun, type RunsOverview, runsOverview, runText, type StageRunResult, startRun } from './stageRuns';

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
  if (!overview.stages.length) return `No Stage Prompt is on for Board ${overview.board}`;
  return renderTable(
    ['Story', 'Stage', 'Stage Run', 'Name'],
    overview.stories.map((s) => [s.key, s.stage, runText(s.stageRun), s.name]),
  );
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

  const run = group.command('run').description("Start, finish, fail or clear a Story's Stage Run");
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
};
