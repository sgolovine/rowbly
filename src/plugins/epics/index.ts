import {
  definePlugin,
  isSlug,
  NotFoundError,
  type PluginChangeSet,
  type PluginChangeSetView,
  type PluginCommandOptions,
  type PluginFinding,
  type PluginReadContext,
  toTimestamp,
  UsageError,
  z,
} from '../../plugin-api';
import { commands } from './commands';
import { type EpicFileProblem, epicFileName, isUnavailable, readEpicFiles } from './epicFile';
import { EpicBag, EpicFilter, EpicInput, validate } from './model';
import { storyEpic } from './service';

async function applyInput(changes: PluginChangeSet, key: string, input: unknown, plugin: PluginReadContext) {
  if (input === undefined) return;
  const { epic } = validate(EpicInput, input, 'Epic input');
  await changes.updateStory(key, (story) => plugin.writeBag(story, epic === null ? undefined : { epic }));
}

/**
 * A missing Epic is NOT_FOUND (exit 3), not a refusal (ARCH-04). The Epic is looked up in the Change
 * Set, so an Epic created or deleted earlier in the same operation counts as such (ARCH-30).
 */
async function guardLink(input: unknown, changes: PluginChangeSetView): Promise<undefined> {
  if (input === undefined) return;
  const { epic } = validate(EpicInput, input, 'Epic input');
  if (epic !== null && (await changes.readFile('dataRoot', epicFileName(epic))) === null) {
    throw new NotFoundError(`Epic "${epic}" not found`, { hint: 'create the Epic first' });
  }
}

const linkEpicOption = { flags: '--epic <id>', description: 'the Epic of the Story' };
const clearEpicOption = { flags: '--no-epic', description: 'without an Epic' };

/** `--epic <id>` / `--no-epic` of `stories list`, checked once here rather than per Story (CQ-82). */
const listOptions: PluginCommandOptions = {
  options: [linkEpicOption, clearEpicOption],
  input: ({ epic }) => {
    if (epic === undefined || epic === false) return epic;
    if (typeof epic !== 'string' || !isSlug(epic)) throw new UsageError('--epic needs an Epic ID (lower-kebab-case)');
    return epic;
  },
};

/** Doctor finding codes for Epic files that cannot be read, reported as `EPICS_<code>`. */
const FILE_FINDINGS: Record<EpicFileProblem, string> = {
  unreadable: 'UNREADABLE',
  'conflict-markers': 'CONFLICT_MARKERS',
  'invalid-json': 'INVALID_JSON',
  'unsupported-version': 'UNSUPPORTED_VERSION',
  'schema-invalid': 'SCHEMA_INVALID',
  'id-mismatch': 'ID_MISMATCH',
};

export const epics = definePlugin({
  id: 'epics',
  name: 'Epics',
  description: 'Group Stories from any Boards into Epics',
  // Epics has no settings. The empty schema is deliberate: its parsed settings are `{}`, while the
  // stored entry, unknown keys included, is kept as it is (CQ-83).
  settings: z.object({}),
  bags: { story: EpicBag },
  commands,
  hooks: {
    'stories.create': {
      transform: ({ changes, result, pluginInput, plugin }) => applyInput(changes, result.key, pluginInput, plugin),
      guard: ({ pluginInput, changes }) => guardLink(pluginInput, changes),
    },
    'stories.update': {
      transform: ({ changes, input, pluginInput, plugin }) => applyInput(changes, input.key, pluginInput, plugin),
      guard: ({ pluginInput, changes }) => guardLink(pluginInput, changes),
    },
  },
  options: {
    'stories create': {
      options: [linkEpicOption],
      input: ({ epic }) => (epic === undefined ? undefined : { epic }),
    },
    'stories edit': {
      options: [linkEpicOption, clearEpicOption],
      input: ({ epic }) => (epic === undefined ? undefined : { epic: epic === false ? null : epic }),
    },
    'stories list': listOptions,
  },
  filterStories: (story, filter, plugin) =>
    (storyEpic(plugin, story) ?? false) === validate(EpicFilter, filter, 'Epic filter'),
  async storyRows(story, plugin) {
    return [{ label: 'Epic', value: storyEpic(plugin, story) ?? 'none' }];
  },
  doctor: {
    async check({ data, plugin }) {
      const files = await readEpicFiles(plugin.files);
      const present = new Set(files.map((file) => file.id));
      const fileFindings = files.filter(isUnavailable).map(
        (file): PluginFinding => ({
          code: FILE_FINDINGS[file.problem],
          severity: 'error',
          path: file.path,
          message: `Epic "${file.id}": ${file.message}; fix the file by hand`,
          details: file.issues ? { issues: file.issues } : undefined,
        }),
      );
      // A link to a present Epic is kept even when its file cannot be read: only a missing Epic is fixed.
      const linkFindings = data.stories.flatMap((story): PluginFinding[] => {
        const epic = storyEpic(plugin, story);
        if (!epic || present.has(epic)) return [];
        return [
          {
            code: 'MISSING_EPIC',
            severity: 'warning',
            path: `boards/${story.boardId}/stories/${story.key}/story.json`,
            message: `${story.key} links to missing Epic "${epic}"`,
            async fix(changes) {
              await changes.updateStory(story.key, (s) =>
                plugin.writeBag({ ...s, updatedAt: toTimestamp(plugin.now()) }, undefined),
              );
              return `unlinked ${story.key} from missing Epic "${epic}"`;
            },
          },
        ];
      });
      return [...fileFindings, ...linkFindings];
    },
  },
  tui: () => import('./tui').then((m) => m.tui),
});
