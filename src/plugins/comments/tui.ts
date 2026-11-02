import type { PluginTui } from '../../plugin-api';
import { CommentFormScreen } from './CommentFormScreen';
import { CommentsTab } from './CommentsTab';
import { storedComments } from './comments';

export const tui: PluginTui<Record<string, unknown>> = {
  storySearchText: ({ story, plugin }) =>
    (storedComments(plugin, story) ?? []).flatMap((comment) => Object.values(comment).filter((v) => v !== null)),
  screens: { form: CommentFormScreen },
  storyTabs: [{ label: 'Comments', component: CommentsTab }],
};
