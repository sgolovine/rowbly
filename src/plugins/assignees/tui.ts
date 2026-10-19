import type { PluginFormValue, PluginTui } from '../../plugin-api';
import { AssigneeDetail } from './AssigneeDetail';
import { AssigneeForm } from './AssigneeForm';
import { AssigneeList } from './AssigneeList';
import { AssigneesBag } from './model';
import { listAssignees } from './roster';
import { storyAssignees } from './service';

/** The chosen options of a multiselect. */
function many(value: PluginFormValue | undefined): string[] {
  return Array.isArray(value) ? value : [];
}

/** The filter's handles, with `me` for "Assigned to me"; `undefined` for no filter. */
function chosenHandles(values: Record<string, PluginFormValue>): string[] | undefined {
  const handles = [...many(values.assignee), ...(values.me === true ? ['me'] : [])];
  return handles.length > 0 ? handles : undefined;
}

export const tui: PluginTui<Record<string, unknown>> = {
  screens: { list: AssigneeList, detail: AssigneeDetail, form: AssigneeForm },
  settings: [{ label: 'Assignees', screen: 'list' }],
  storyBadges: ({ story, plugin }) => storyAssignees(plugin, story).map((handle) => `@${handle}`),
  storyForm: {
    async fields({ story, plugin }) {
      if (story && plugin.inspectBag(story, AssigneesBag).kind === 'invalid') {
        return [
          {
            name: 'assignees',
            label: 'Assignees',
            kind: 'multiselect',
            unavailable: 'stored value is invalid; kept unchanged',
          },
        ];
      }
      // A Story's own Assignees stay visible and removable, even when they are no longer in the roster.
      const options = (await listAssignees(plugin)).map((a) => a.handle);
      const assigned = story ? storyAssignees(plugin, story) : [];
      for (const handle of assigned) if (!options.includes(handle)) options.push(handle);
      return [{ name: 'assignees', label: 'Assignees', kind: 'multiselect', options, value: assigned }];
    },
    // Called only when the field changed, so an empty list on an existing Story clears it.
    input: ({ values }) => ({ assignees: many(values.assignees) }),
  },
  storyFilter: {
    async fields({ plugin }) {
      const options = (await listAssignees(plugin)).map((a) => a.handle);
      return [
        { name: 'assignee', label: 'Assignees', kind: 'multiselect', options },
        { name: 'me', label: 'Assigned to me', kind: 'boolean' },
      ];
    },
    filter: chosenHandles,
    describe(values) {
      return [
        many(values.assignee)
          .map((h) => `@${h}`)
          .join(' '),
        values.me === true && 'mine',
      ]
        .filter(Boolean)
        .join(' · ');
    },
  },
};
