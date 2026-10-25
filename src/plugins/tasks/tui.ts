import type { PluginTui } from '../../plugin-api';
import { TaskFormScreen } from './TaskFormScreen';
import { TaskScreen } from './TaskScreen';
import { TasksCreateTab } from './TasksCreateTab';
import { TasksTab } from './TasksTab';
import { doneCount, storedTasks } from './tasks';

export const tui: PluginTui<Record<string, unknown>> = {
  screens: { task: TaskScreen, form: TaskFormScreen },
  storyCreateTabs: [{ label: 'Tasks', component: TasksCreateTab, input: (draft) => ({ tasks: draft }) }],
  storyTabs: [{ label: 'Tasks', component: TasksTab }],
  /** `✓ done/total` over the Story's Tasks, judged by Stage Category; none without Tasks. */
  cardBadge({ story, stages, plugin }) {
    const list = storedTasks(plugin, story);
    if (!list?.length) return null;
    return `✓ ${doneCount(list, stages)}/${list.length}`;
  },
};
