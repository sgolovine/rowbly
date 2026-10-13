// A fixture Plugin that uses most of the Plugin API: settings, a Story bag, a transform, a guard and
// a reaction, its own commands and files, options on core commands, a filter, `stories show` rows,
// a doctor check with a fix, an Action and a TUI part. Like a Built-in Plugin, it imports only the
// Plugin API.
import { definePlugin, type PluginChangeSet, type PluginContext, type Story, z } from '../../../src/plugin-api';

export const NotesSettings = z.object({
  /** Shown before each note in `stories show`. */
  marker: z.string().default('note'),
  /** Names that the guard refuses. */
  blocked: z.array(z.string()).default([]),
});
export type NotesSettings = z.infer<typeof NotesSettings>;

/** The Notes bag on a Story. */
export const NoteBag = z.object({ note: z.string().min(1) });

/** Notes input: `{ note: 'text' }` sets the note, `{ note: null }` removes it. */
const NoteInput = z.object({ note: z.string().nullable() });

function setNote(plugin: PluginContext<NotesSettings>, story: Story, note: string | null): Story {
  return plugin.writeBag(story, note === null ? undefined : { note });
}

/** Applies the Notes input of an operation to the Story it saved. */
async function applyInput(
  changes: PluginChangeSet,
  key: string | undefined,
  input: unknown,
  plugin: PluginContext<NotesSettings>,
) {
  const parsed = NoteInput.safeParse(input);
  if (!parsed.success || !key) return;
  await changes.updateStory(key, (story) => setNote(plugin, story, parsed.data.note));
}

export const notes = definePlugin<NotesSettings>({
  id: 'notes',
  name: 'Notes',
  description: 'Short notes on Stories, for testing the Plugin API',
  settings: NotesSettings,
  bags: { story: NoteBag },
  hooks: {
    'stories.create': {
      async transform({ changes, pluginInput, plugin }) {
        const created = changes.changes.find((c) => c.type === 'story' && c.before === null);
        const key = created?.type === 'story' ? created.after?.key : undefined;
        await applyInput(changes, key, pluginInput, plugin);
      },
      guard({ input, plugin }) {
        if (plugin.settings.blocked.includes(input.name)) {
          return { reject: `Notes refuses a Story named "${input.name}"`, hint: 'pick another name' };
        }
        return undefined;
      },
      react({ result, plugin }) {
        plugin.warn(`notes saw ${result.key} created`);
      },
    },
    'stories.update': {
      async transform({ changes, input, pluginInput, plugin }) {
        await applyInput(changes, input.key, pluginInput, plugin);
      },
    },
  },
  options: {
    'stories create': {
      options: [{ flags: '--note <text>', description: 'a note for the Story' }],
      input: ({ note }) => (typeof note === 'string' ? { note } : undefined),
    },
    'stories edit': {
      options: [
        { flags: '--note <text>', description: 'set the note' },
        { flags: '--no-note', description: 'remove the note' },
      ],
      input: ({ note }) => (note === undefined ? undefined : { note: note === false ? null : note }),
    },
    'stories list': {
      options: [{ flags: '--noted', description: 'only Stories with a note' }],
      input: ({ noted }) => (noted ? true : undefined),
    },
  },
  filterStories: (story, filter, plugin) => (plugin.readBag(story, NoteBag) !== undefined) === filter,
  async storyRows(story, plugin) {
    const bag = plugin.readBag(story, NoteBag);
    return bag ? [{ label: 'Note', value: `${plugin.settings.marker}: ${bag.note}` }] : [];
  },
  commands(group, cli) {
    group
      .command('add <name> <text>')
      .description('Write a note file in the Data Root')
      .action((name: string, text: string, _opts: unknown, cmd) =>
        cli.run(cmd, async ({ plugin, print }) => {
          await plugin.operation('add', { name }, (changes) => changes.writeFile('dataRoot', `${name}.txt`, text));
          print({ added: name }, () => `Added note ${name}`);
        }),
      );
    group
      .command('attach <key> <text>')
      .description('Write a note file in a Story folder')
      .action((key: string, text: string, _opts: unknown, cmd) =>
        cli.run(cmd, async ({ plugin, print }) => {
          await plugin.operation('attach', { key }, (changes) => changes.writeFile({ story: key }, 'note.txt', text));
          print({ attached: key }, () => `Attached a note to ${key}`);
        }),
      );
    group
      .command('list')
      .description('List the note files of the Data Root')
      .option('--board <id>', 'the files of a Board instead')
      .action((opts: { board?: string }, cmd) =>
        cli.run(cmd, async ({ plugin, print }) => {
          const files = await plugin.files.list(opts.board ? { board: opts.board } : 'dataRoot');
          print(files, (list) => list.join('\n'));
        }),
      );
    group
      .command('settings [board]')
      .description('Print the settings, or those of a Board')
      .action((board: string | undefined, _opts: unknown, cmd) =>
        cli.run(cmd, async ({ plugin, print }) => {
          print(board ? await plugin.boardSettings(board) : plugin.settings, (s) => JSON.stringify(s));
        }),
      );
  },
  doctor: {
    check({ data, plugin }) {
      return data.stories
        .filter((story) => plugin.readBag(story, NoteBag)?.note === 'bad')
        .map((story) => ({
          code: 'BAD_NOTE',
          severity: 'warning' as const,
          path: `boards/${story.boardId}/stories/${story.key}/story.json`,
          message: `${story.key} has a bad note`,
          async fix(changes) {
            await changes.updateStory(story.key, (s) => setNote(plugin, s, null));
            return `removed the bad note of ${story.key}`;
          },
        }));
    },
  },
  actions: [
    {
      key: 'Z',
      label: 'Note',
      target: 'story',
      run: ({ focus, ui }) => ui.open('note', { key: focus.story?.key, title: 'Note' }),
    },
  ],
  tui: () => import('./notesTui').then((m) => m.notesTui),
});
