// A fixture Plugin that stores one editable Story field, Story points, written the way the Plugin
// API guide recommends: typed input and filter schemas, the CLI and TUI converters, a filter, a row and
// strict settings. It needs no casts. It is also the re-measured example of DX-01's exercise.
import { definePlugin, type PluginChangeSet, type PluginReadContext, type Story, z } from '../../../src/plugin-api';

/** The points bag on a Story. */
export const PointsBag = z.object({ points: z.number().int().min(0) });

/** Points input: a number sets the points, `null` clears them; no input changes nothing. */
const PointsInput = z.object({ points: z.number().int().min(0).nullable() });

/** `--points <n>`: the number, or `NaN` for text that is not one, which the input schema rejects. */
function pointsOption(value: string | readonly string[] | boolean | undefined): number | null | undefined {
  if (value === undefined) return undefined;
  if (value === false) return null;
  return typeof value === 'string' && value.trim() !== '' ? Number(value) : Number.NaN;
}

async function apply(
  changes: PluginChangeSet,
  key: string,
  input: z.output<typeof PointsInput> | undefined,
  plugin: PluginReadContext,
) {
  if (input === undefined) return;
  const { points } = input;
  await changes.updateStory(key, (story) => plugin.writeBag(story, points === null ? undefined : { points }));
}

function storyPoints(plugin: PluginReadContext, story: Story): number | undefined {
  return plugin.readBag(story, PointsBag)?.points;
}

export const points = definePlugin({
  id: 'points',
  name: 'Points',
  description: 'Story points',
  // Strict, so a typo in the settings fails the load instead of being dropped (DX-35).
  settings: z.strictObject({ label: z.string().default('Points') }),
  bags: { story: PointsBag },
  inputs: { 'stories.create': PointsInput, 'stories.update': PointsInput },
  storyFilterSchema: z.number().int().min(0),
  hooks: {
    'stories.create': {
      transform: ({ changes, result, pluginInput, plugin }) => apply(changes, result.key, pluginInput, plugin),
    },
    'stories.update': {
      transform: ({ changes, input, pluginInput, plugin }) => apply(changes, input.key, pluginInput, plugin),
    },
  },
  options: {
    'stories create': {
      options: [{ flags: '--points <n>', description: 'the Story points' }],
      input: ({ points }) => {
        const value = pointsOption(points);
        return value === undefined ? undefined : { points: value };
      },
    },
    'stories edit': {
      options: [
        { flags: '--points <n>', description: 'set the Story points' },
        { flags: '--no-points', description: 'remove the Story points' },
      ],
      input: ({ points }) => {
        const value = pointsOption(points);
        return value === undefined ? undefined : { points: value };
      },
    },
    'stories list': {
      options: [{ flags: '--points <n>', description: 'only Stories with these points' }],
      filter: ({ points }) => pointsOption(points) ?? undefined,
    },
  },
  filterStories: (story, filter, plugin) => storyPoints(plugin, story) === filter,
  async storyRows(story, plugin) {
    const value = storyPoints(plugin, story);
    return value === undefined ? [] : [{ label: plugin.settings.label, value: String(value) }];
  },
  tui: async () => ({
    storyForm: {
      async fields({ story, plugin }) {
        return [{ name: 'points', label: 'Points', kind: 'number', value: story ? storyPoints(plugin, story) : null }];
      },
      input: ({ values }) => ({ points: typeof values.points === 'number' ? values.points : null }),
    },
    storyFilter: {
      async fields() {
        return [{ name: 'points', label: 'Points', kind: 'number' }];
      },
      filter: (values) => (typeof values.points === 'number' ? values.points : undefined),
      describe: (values) => (typeof values.points === 'number' ? `${values.points} points` : ''),
    },
  }),
});
