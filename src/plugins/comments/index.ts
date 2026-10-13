import { definePlugin } from '../../plugin-api';
import { commands } from './commands';
import { commentsOn } from './comments';
import { CommentsBag } from './model';

export const comments = definePlugin({
  id: 'comments',
  name: 'Comments',
  description: 'Comments on Stories and Tasks',
  bags: { story: CommentsBag, task: CommentsBag },
  commands,
  async storyRows(story, plugin) {
    return [{ label: 'Comments', value: String(commentsOn(plugin, story).length) }];
  },
  async taskRows(task, _story, plugin) {
    return [{ label: 'Comments', value: String(commentsOn(plugin, task).length) }];
  },
  tui: () => import('./tui').then((m) => m.tui),
});
