// The tutorial's Points TUI part (docs/plugins/writing-a-plugin.md, steps 6 and 7). Only the TUI loads it.
// #region tui
import type { PluginTui } from '../../../../src/plugin-api';
import { PointsBag, type PointsSettings, storyPoints } from './model';
import { PointsScreen } from './PointsScreen';

export const tui: PluginTui<PointsSettings> = {
  // #endregion
  // #region fields
  storyForm: {
    async fields({ story, plugin }) {
      // An invalid stored bag is shown as unavailable and kept unless the person resets it.
      if (story && plugin.inspectBag(story, PointsBag).kind === 'invalid') {
        return [
          {
            name: 'points',
            label: plugin.settings.label,
            kind: 'number',
            unavailable: 'stored value is invalid; kept unchanged',
          },
        ];
      }
      const value = story ? (storyPoints(plugin, story) ?? null) : null;
      return [{ name: 'points', label: plugin.settings.label, kind: 'number', value }];
    },
    // Called only when the field changed. An empty number is `null`: the explicit clear.
    input({ values, story }) {
      if (typeof values.points === 'number') return { points: values.points };
      return story ? { points: null } : undefined;
    },
  },
  storyFilter: {
    async fields({ plugin }) {
      return [{ name: 'points', label: plugin.settings.label, kind: 'number' }];
    },
    filter: (values) => (typeof values.points === 'number' ? values.points : undefined),
    describe: (values) => (typeof values.points === 'number' ? `${values.points} points` : ''),
  },
  // #endregion
  // #region screens
  screens: { list: PointsScreen },
  home: [{ label: 'Points', screen: 'list' }],
};
// #endregion
