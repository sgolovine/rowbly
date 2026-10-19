import type { PluginTui } from '../../plugin-api';
import { CommentFormScreen } from './CommentFormScreen';
import { CommentsTab } from './CommentsTab';

export const tui: PluginTui<Record<string, unknown>> = {
  screens: { form: CommentFormScreen },
  storyTabs: [{ label: 'Comments', component: CommentsTab }],
};
