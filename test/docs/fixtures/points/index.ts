// The tutorial's Points Plugin (docs/plugins/writing-a-plugin.md): one editable Story field, end to end.
// #region definition
import {
  definePlugin,
  type GuardResult,
  type PluginChangeSet,
  type PluginChangeSetView,
  type PluginFinding,
  type PluginReadContext,
  type Story,
  z,
} from '../../../../src/plugin-api';
import { commands } from './commands';
import { PointsBag, PointsInput, PointsSettings, storyPoints } from './model';

/** A CLI value as points. Text that is not a number becomes `NaN`, which the input schema rejects. */
function toPoints(value: string | readonly string[] | boolean): number {
  return typeof value === 'string' && value.trim() !== '' ? Number(value) : Number.NaN;
}

export const points = definePlugin({
  id: 'points',
  name: 'Points',
  description: 'Story points for estimates',
  settings: PointsSettings,
  bags: { story: PointsBag },
  inputs: { 'stories.create': PointsInput, 'stories.update': PointsInput },
  storyFilterSchema: z.number().int().min(0),
  // #endregion
  // #region hooks
  hooks: {
    'stories.create': {
      transform: ({ changes, result, pluginInput, plugin }) => apply(changes, result.key, pluginInput, plugin),
      guard: ({ changes, plugin }) => aboveMax(changes, plugin),
    },
    'stories.update': {
      transform: ({ changes, input, pluginInput, plugin }) => apply(changes, input.key, pluginInput, plugin),
      guard: ({ changes, plugin }) => aboveMax(changes, plugin),
    },
  },
  // #endregion
  // #region options
  options: {
    'stories create': {
      options: [{ flags: '--points <n>', description: 'the Story points' }],
      input: ({ points }) => (points === undefined ? undefined : { points: toPoints(points) }),
    },
    'stories edit': {
      options: [
        { flags: '--points <n>', description: 'set the Story points' },
        { flags: '--no-points', description: 'remove the Story points' },
      ],
      input: ({ points }) =>
        points === undefined ? undefined : { points: points === false ? null : toPoints(points) },
    },
    'stories list': {
      options: [{ flags: '--points <n>', description: 'only Stories with these points' }],
      filter: ({ points }) => (points === undefined ? undefined : toPoints(points)),
    },
  },
  filterStories: (story, filter, plugin) => storyPoints(plugin, story) === filter,
  async storyRows(story, plugin) {
    const value = storyPoints(plugin, story);
    return value === undefined ? [] : [{ label: plugin.settings.label, value: String(value) }];
  },
  // #endregion
  // #region more
  commands,
  doctor: { check: ({ data, plugin }) => checkPoints(data.stories, plugin) },
  tui: () => import('./tui').then((m) => m.tui),
});
// #endregion

// #region apply
/** Applies this Plugin's input to Story `key`: `undefined` changes nothing, `null` clears, a number sets. */
async function apply(
  changes: PluginChangeSet,
  key: string,
  input: PointsInput | undefined,
  plugin: PluginReadContext<PointsSettings>,
): Promise<void> {
  if (input === undefined) return;
  const { points } = input;
  await changes.updateStory(key, (story) => plugin.writeBag(story, points === null ? undefined : { points }));
}
// #endregion

// #region guard
/** Refuses a Story whose points are above its Board's `max`, a rule no schema can check alone. */
async function aboveMax(changes: PluginChangeSetView, plugin: PluginReadContext<PointsSettings>): Promise<GuardResult> {
  for (const change of changes.changes) {
    if (change.type !== 'story' || change.after === null) continue;
    const points = plugin.readBag(change.after, PointsBag)?.points;
    const { max } = await plugin.boardSettings(change.after.boardId);
    if (points !== undefined && points > max) {
      return {
        reject: `Story ${change.after.key} has ${points} points; its Board allows at most ${max}`,
        hint: 'use fewer points, or raise "max" in the Board settings',
      };
    }
  }
  return undefined;
}
// #endregion

// #region doctor
/** Finds Stories above their Board's `max`, e.g. after `max` was lowered. `--fix` lowers them to `max`. */
async function checkPoints(
  stories: readonly Story[],
  plugin: PluginReadContext<PointsSettings>,
): Promise<PluginFinding[]> {
  const findings: PluginFinding[] = [];
  for (const story of stories) {
    const points = storyPoints(plugin, story);
    const { max } = await plugin.boardSettings(story.boardId);
    if (points === undefined || points <= max) continue;
    findings.push({
      code: 'ABOVE_MAX',
      severity: 'warning',
      path: `boards/${story.boardId}/stories/${story.key}/story.json`,
      message: `Story ${story.key} has ${points} points; its Board allows at most ${max}`,
      async fix(changes) {
        await changes.updateStory(story.key, (s) => plugin.writeBag(s, { points: max }));
        return `set Story ${story.key} to ${max} points`;
      },
    });
  }
  return findings;
}
// #endregion
