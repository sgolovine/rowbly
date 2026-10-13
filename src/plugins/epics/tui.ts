import type { PluginTui } from '../../plugin-api';
import { EpicDetail } from './EpicDetail';
import { EpicForm } from './EpicForm';
import { EpicList } from './EpicList';
import { listEpics, storyEpic } from './service';

export const tui: PluginTui<Record<string, unknown>> = {
  screens: { list: EpicList, detail: EpicDetail, form: EpicForm },
  home: [{ label: 'Epics', screen: 'list' }],
  storyForm: {
    async fields({ story, plugin }) {
      const epics = await listEpics(plugin, 'all');
      const linked = story ? storyEpic(plugin, story) : undefined;
      const options = epics.map((epic) => epic.id);
      if (linked && !options.includes(linked)) options.push(linked);
      return [
        {
          name: 'epic',
          label: 'Epic',
          kind: 'select',
          options: ['No Epic', ...options],
          value: linked ?? 'No Epic',
        },
      ];
    },
    input: (values, story) =>
      typeof values.epic === 'string' && values.epic !== '' && values.epic !== 'No Epic'
        ? { epic: values.epic }
        : story
          ? { epic: null }
          : undefined,
  },
  storyFilter: {
    async fields({ plugin }) {
      return [
        {
          name: 'epic',
          label: 'Epic',
          kind: 'select',
          options: ['All Epics', 'No Epic', ...(await listEpics(plugin, 'all')).map((epic) => epic.id)],
        },
      ];
    },
    filter: (values) =>
      values.epic === 'No Epic' ? false : values.epic === 'All Epics' ? undefined : values.epic || undefined,
    describe: (values) =>
      values.epic === 'No Epic' ? 'no Epic' : values.epic && values.epic !== 'All Epics' ? `Epic: ${values.epic}` : '',
  },
};
