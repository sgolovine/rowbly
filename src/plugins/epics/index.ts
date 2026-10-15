import {
  definePlugin,
  NotFoundError,
  type PluginChangeSet,
  type PluginReadContext,
  toTimestamp,
  z,
} from '../../plugin-api';
import { commands } from './commands';
import { EpicBag, EpicInput, validate } from './model';
import { storyEpic } from './service';

async function applyInput(changes: PluginChangeSet, key: string, input: unknown, plugin: PluginReadContext) {
  if (input === undefined) return;
  const { epic } = validate(EpicInput, input);
  await changes.updateStory(key, (story) => plugin.writeBag(story, epic === null ? undefined : { epic }));
}

/** A missing Epic is NOT_FOUND (exit 3), not a refusal (ARCH-04). */
async function guardLink(input: unknown, plugin: PluginReadContext): Promise<undefined> {
  if (input === undefined) return;
  const { epic } = validate(EpicInput, input);
  if (epic !== null && (await plugin.files.read('dataRoot', `${epic}.json`)) === null) {
    throw new NotFoundError(`Epic "${epic}" not found`, { hint: 'create the Epic first' });
  }
}

const epicOptions = [
  { flags: '--epic <id>', description: 'the Epic of the Story' },
  { flags: '--no-epic', description: 'without an Epic' },
];

export const epics = definePlugin({
  id: 'epics',
  name: 'Epics',
  description: 'Group Stories from any Boards into Epics',
  settings: z.object({}),
  bags: { story: EpicBag },
  commands,
  hooks: {
    'stories.create': {
      transform: ({ changes, result, pluginInput, plugin }) => applyInput(changes, result.key, pluginInput, plugin),
      guard: ({ pluginInput, plugin }) => guardLink(pluginInput, plugin),
    },
    'stories.update': {
      transform: ({ changes, input, pluginInput, plugin }) => applyInput(changes, input.key, pluginInput, plugin),
      guard: ({ pluginInput, plugin }) => guardLink(pluginInput, plugin),
    },
  },
  options: {
    'stories create': {
      options: epicOptions.slice(0, 1),
      input: ({ epic }) => (epic === undefined ? undefined : { epic }),
    },
    'stories edit': {
      options: epicOptions,
      input: ({ epic }) => (epic === undefined ? undefined : { epic: epic === false ? null : epic }),
    },
    'stories list': { options: epicOptions, input: ({ epic }) => epic },
  },
  filterStories: (story, filter, plugin) => (storyEpic(plugin, story) ?? false) === filter,
  async storyRows(story, plugin) {
    return [{ label: 'Epic', value: storyEpic(plugin, story) ?? 'none' }];
  },
  doctor: {
    async check({ data, plugin }) {
      const files = new Set(await plugin.files.list('dataRoot'));
      return data.stories.flatMap((story) => {
        const epic = storyEpic(plugin, story);
        if (!epic || files.has(`${epic}.json`)) return [];
        return [
          {
            code: 'MISSING_EPIC',
            severity: 'warning' as const,
            path: `boards/${story.boardId}/stories/${story.key}/story.json`,
            message: `${story.key} links to missing Epic "${epic}"`,
            async fix(changes: PluginChangeSet) {
              await changes.updateStory(story.key, (s) =>
                plugin.writeBag({ ...s, updatedAt: toTimestamp(plugin.now()) }, undefined),
              );
              return `unlinked ${story.key} from missing Epic "${epic}"`;
            },
          },
        ];
      });
    },
  },
  tui: () => import('./tui').then((m) => m.tui),
});
