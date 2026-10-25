import { isSlug, type PluginFormValue, type PluginTui } from '../../plugin-api';
import { EpicDetail } from './EpicDetail';
import { EpicForm } from './EpicForm';
import { EpicList } from './EpicList';
import { EpicBag } from './model';
import { listEpics, readEpics, storyEpic } from './service';

/** The Story form's "no Epic" choice, and the filter's "Stories without an Epic". No Epic ID can be either. */
const NO_EPIC = 'No Epic';
/** The filter's "any Epic, or none": no filter. */
const ALL_EPICS = 'All Epics';

/** The Epic chosen in a filter: an Epic ID, `false` for no Epic, `undefined` for no filter. */
function chosenEpic(value: PluginFormValue | undefined): string | false | undefined {
  if (value === NO_EPIC) return false;
  if (typeof value !== 'string' || value === '' || value === ALL_EPICS) return undefined;
  return value;
}

export const tui: PluginTui<Record<string, unknown>> = {
  screens: { list: EpicList, detail: EpicDetail, form: EpicForm },
  home: [{ label: 'Epics', screen: 'list' }],
  /** `◆ <Epic name>` on a Story of an Epic; its ID when the Epic file is missing or cannot be read. */
  async loadStoryBadges({ plugin }) {
    const names = new Map((await readEpics(plugin)).epics.map((epic) => [epic.id, epic.name]));
    return (story) => {
      const epic = storyEpic(plugin, story);
      return epic ? [`◆ ${names.get(epic) ?? epic}`] : [];
    };
  },
  /** The open Epics by name; picking one shows only its Stories on the board. */
  sidebar: {
    title: 'Epics',
    allLabel: ALL_EPICS,
    async items({ plugin }) {
      return (await listEpics(plugin, 'open')).map((epic) => ({ value: epic.id, label: epic.name }));
    },
    filter: (id) => id,
    menu: (id) => [
      { label: 'Edit', key: 'e', screen: 'form', params: { id, title: `Edit ${id}` } },
      { label: 'Delete', key: 'd', screen: 'detail', params: { id, title: `Delete ${id}`, confirmDelete: true } },
    ],
    create: { label: '+ New Epic', screen: 'form', params: { title: 'New Epic' } },
  },
  storyForm: {
    async fields({ story, plugin }) {
      if (story && plugin.inspectBag(story, EpicBag).kind === 'invalid') {
        return [
          { name: 'epic', label: 'Epic', kind: 'select', unavailable: 'stored value is invalid; kept unchanged' },
        ];
      }
      // Epic files that cannot be read are not offered, but a Story's own Epic stays visible and
      // removable, whether its file is missing or unreadable.
      const options = (await readEpics(plugin)).epics.map((epic) => epic.id);
      const linked = story ? storyEpic(plugin, story) : undefined;
      if (linked && !options.includes(linked)) options.push(linked);
      return [
        { name: 'epic', label: 'Epic', kind: 'select', options: [NO_EPIC, ...options], value: linked ?? NO_EPIC },
      ];
    },
    // Called only when the field changed: a chosen Epic links it; anything else on an existing Story is
    // the explicit clear (`null`). A new Story without an Epic has no input.
    input({ values, story }) {
      const epic = values.epic;
      if (typeof epic === 'string' && epic !== '' && epic !== NO_EPIC) return { epic };
      if (story) return { epic: null };
      return undefined;
    },
  },
  storyFilter: {
    async fields({ plugin }) {
      // Unreadable Epic files are offered too, so their Stories can still be found.
      const { epics, unavailable } = await readEpics(plugin);
      const ids = [...epics, ...unavailable]
        .map((epic) => epic.id)
        .filter(isSlug)
        .sort();
      return [{ name: 'epic', label: 'Epic', kind: 'select', options: [ALL_EPICS, NO_EPIC, ...ids] }];
    },
    filter: (values) => chosenEpic(values.epic),
    describe(values) {
      const epic = chosenEpic(values.epic);
      if (epic === undefined) return '';
      if (epic === false) return 'no Epic';
      return `Epic: ${epic}`;
    },
  },
};
