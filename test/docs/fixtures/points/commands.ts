// The tutorial's Points commands (docs/WRITING-A-PLUGIN.md, steps 5 and 9).
// #region commands
import { type PluginCommands, renderTable } from '../../../../src/plugin-api';
import { type PointsSettings, storyPoints } from './model';

export const commands: PluginCommands<PointsSettings> = (group, cli) => {
  group
    .command('total')
    .description('Add up the points of a Board')
    .option('--board <id>', 'the Board; defaults to the current Board')
    .action((opts: { board?: string }, cmd) =>
      cli.run(cmd, async ({ plugin, services, print, resolveBoard }) => {
        const board = await resolveBoard(opts.board);
        const stories = await services.stories.list(board, {});
        const counted = stories.flatMap((story) => {
          const points = storyPoints(plugin, story);
          return points === undefined ? [] : [{ key: story.key, points }];
        });
        const total = counted.reduce((sum, story) => sum + story.points, 0);
        print({ board, stories: counted, total }, (t) =>
          [
            renderTable(
              ['Story', plugin.settings.label],
              t.stories.map((s) => [s.key, String(s.points)]),
            ),
            `Total: ${t.total}`,
          ].join('\n'),
        );
      }),
    );
  // #endregion
  // #region note
  group
    .command('note <key>')
    .description('Show or set the note that explains a Story estimate')
    .option('--text <md>', 'the note')
    .option('--text-file <path>', 'read the note from a file, or - for stdin')
    .option('--edit', 'edit the note in $EDITOR')
    .action((key: string, opts: { text?: string; textFile?: string; edit?: boolean }, cmd) =>
      cli.run(cmd, async ({ plugin, services, print, readText }) => {
        const story = await services.stories.get(key);
        const scope = { story: story.key };
        const text = await readText({ text: opts.text, file: opts.textFile, edit: opts.edit }, { name: 'text' });
        if (text === undefined) {
          const note = await plugin.files.read(scope, 'estimate.md');
          print({ key: story.key, note }, (n) => n.note ?? `Story ${n.key} has no note.`);
          return;
        }
        // One operation, `points.note`, so other Plugins can hook it.
        await plugin.operation('note', { key: story.key }, (changes) => changes.writeFile(scope, 'estimate.md', text));
        print({ key: story.key, note: text }, (n) => `Saved the note of Story ${n.key}`);
      }),
    );
};
// #endregion
