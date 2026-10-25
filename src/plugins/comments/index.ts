import { type Bagged, definePlugin, type PluginReadContext } from '../../plugin-api';
import { commands } from './commands';
import { storedComments } from './comments';
import { CommentsBag } from './model';
import { reconcile } from './reconcile';

export const comments = definePlugin({
  reconcile,
  id: 'comments',
  name: 'Comments',
  description: 'Comments on Stories',
  bags: { story: CommentsBag },
  commands,
  async storyRows(story, plugin) {
    return [countRow(plugin, story)];
  },
  tui: () => import('./tui').then((m) => m.tui),
});

/** How many Comments a Story has; an invalid stored Thread shows as unavailable, not as 0. */
function countRow(plugin: PluginReadContext, record: Bagged) {
  const stored = storedComments(plugin, record);
  return { label: 'Comments', value: stored ? String(stored.length) : 'unavailable (invalid)' };
}
