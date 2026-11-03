import { type Bagged, definePlugin, type PluginReadContext } from '../../plugin-api';
import { commands } from './commands';
import { listComments, storedComments } from './comments';
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
  async storyContext(story, plugin) {
    // Oldest first; an invalid Thread throws, so the Story Context lists Comments as incomplete.
    const thread = await listComments(plugin, story.key);
    const text = thread.map((c) => `**${c.author ?? 'unknown'}**, ${c.createdAt} (${c.id}):\n\n${c.body.trim()}`);
    return { title: 'Comments', text: text.join('\n\n') || 'None.', data: thread };
  },
  tui: () => import('./tui').then((m) => m.tui),
});

/** How many Comments a Story has; an invalid stored Thread shows as unavailable, not as 0. */
function countRow(plugin: PluginReadContext, record: Bagged) {
  const stored = storedComments(plugin, record);
  return { label: 'Comments', value: stored ? String(stored.length) : 'unavailable (invalid)' };
}
