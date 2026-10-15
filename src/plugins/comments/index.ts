import { type Bagged, definePlugin, type PluginReadContext } from '../../plugin-api';
import { commands } from './commands';
import { storedComments } from './comments';
import { CommentsBag } from './model';

export const comments = definePlugin({
  id: 'comments',
  name: 'Comments',
  description: 'Comments on Stories and Tasks',
  bags: { story: CommentsBag, task: CommentsBag },
  commands,
  async storyRows(story, plugin) {
    return [countRow(plugin, story)];
  },
  async taskRows(task, _story, plugin) {
    return [countRow(plugin, task)];
  },
  tui: () => import('./tui').then((m) => m.tui),
});

/** How many Comments a Story or Task has; an invalid stored Thread shows as unavailable, not as 0. */
function countRow(plugin: PluginReadContext, record: Bagged) {
  const stored = storedComments(plugin, record);
  return { label: 'Comments', value: stored ? String(stored.length) : 'unavailable (invalid)' };
}
