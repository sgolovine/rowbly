import {
  type Bagged,
  definePlugin,
  type PluginFinding,
  type PluginOptionValues,
  type PluginReadContext,
  parseRepeatable,
  toTimestamp,
  UsageError,
  z,
} from '../../plugin-api';
import { commands } from './commands';
import { AssigneesBag, AssigneesFilter, AssigneesInput } from './model';
import { parseRoster, ROSTER_FILE, ROSTER_PATH } from './roster';
import { applyInput, resolveMe, setAssignees, storyAssignees } from './service';

/** The handles of a repeatable option, comma-separated values split; `undefined` when it was not given. */
function handles(value: PluginOptionValues[string]): string[] | undefined {
  return value === undefined || typeof value === 'boolean' ? undefined : parseRepeatable(value);
}

const assigneeOption = {
  flags: '--assignee <handle>',
  description: 'Assignee handle; "me" is Me (repeatable, comma-separated)',
  repeatable: true,
};

/** The Story's Assignees for display: `none` without any. */
function assigneesText(plugin: PluginReadContext, story: Bagged): string {
  return storyAssignees(plugin, story).join(', ') || 'none';
}

export const assignees = definePlugin({
  id: 'assignees',
  name: 'Assignees',
  description: 'A roster of people who can be assigned to Stories',
  // Assignees has no settings; the roster is a Plugin file (ADR-0013).
  settings: z.object({}),
  bags: { story: AssigneesBag },
  inputs: { 'stories.create': AssigneesInput, 'stories.update': AssigneesInput },
  storyFilterSchema: AssigneesFilter,
  commands,
  hooks: {
    'stories.create': {
      transform: ({ changes, result, pluginInput, plugin }) => applyInput(plugin, changes, result.key, pluginInput),
    },
    'stories.update': {
      transform: ({ changes, input, pluginInput, plugin }) => applyInput(plugin, changes, input.key, pluginInput),
    },
  },
  options: {
    'stories create': {
      options: [assigneeOption],
      input: ({ assignee }) => {
        const list = handles(assignee);
        return list === undefined ? undefined : { assignees: list };
      },
    },
    'stories edit': {
      options: [
        { ...assigneeOption, description: 'replace the Assignees; "me" is Me (repeatable, comma-separated)' },
        { flags: '--add-assignee <handle>', description: 'add Assignees (repeatable)', repeatable: true },
        { flags: '--remove-assignee <handle>', description: 'remove Assignees (repeatable)', repeatable: true },
      ],
      input: ({ assignee, addAssignee, removeAssignee }) => {
        const input = { assignees: handles(assignee), add: handles(addAssignee), remove: handles(removeAssignee) };
        if (input.assignees && (input.add || input.remove)) {
          throw new UsageError('replace the Assignees or add/remove them, not both');
        }
        return Object.values(input).some((v) => v !== undefined) ? input : undefined;
      },
    },
    'stories list': {
      options: [
        { ...assigneeOption, description: 'only Stories with any of these Assignees; "me" is Me (repeatable)' },
      ],
      filter: ({ assignee }) => {
        const list = handles(assignee);
        return list?.length ? list : undefined;
      },
    },
  },
  filterStories(story, filter: z.output<typeof AssigneesFilter>, plugin) {
    const wanted = filter.map((h) => resolveMe(plugin, h));
    return storyAssignees(plugin, story).some((h) => wanted.includes(h));
  },
  async storyRows(story, plugin) {
    return [{ label: 'Assignees', value: assigneesText(plugin, story) }];
  },
  async taskRows(_task, story, plugin) {
    const text = assigneesText(plugin, story);
    return [{ label: 'Assignees', value: text === 'none' ? text : `${text} (from the Story)` }];
  },
  doctor: {
    async check({ data, plugin }) {
      const text = await plugin.files.read('dataRoot', ROSTER_FILE);
      const roster = text === null ? { assignees: [] } : parseRoster(text);
      if ('problem' in roster) {
        return [
          {
            code: 'ROSTER_UNAVAILABLE',
            severity: 'error',
            path: ROSTER_PATH,
            message: `The Assignee roster cannot be read: ${roster.problem}; fix the file by hand`,
          },
        ];
      }
      const known = new Set(roster.assignees.map((a) => a.handle));
      const findings: PluginFinding[] = data.stories.flatMap((story): PluginFinding[] => {
        const unknown = storyAssignees(plugin, story).filter((h) => !known.has(h));
        if (unknown.length === 0) return [];
        return [
          {
            code: 'UNKNOWN_ASSIGNEE',
            severity: 'warning',
            path: `boards/${story.boardId}/stories/${story.key}/story.json`,
            message: `${story.key} has Assignees not in the roster: ${unknown.join(', ')}`,
            async fix(changes) {
              await changes.updateStory(story.key, (s) =>
                setAssignees(
                  plugin,
                  { ...s, updatedAt: toTimestamp(plugin.now()) },
                  storyAssignees(plugin, s).filter((h) => known.has(h)),
                ),
              );
              return `removed ${unknown.join(', ')} from ${story.key}`;
            },
          },
        ];
      });
      const me = data.local.me;
      if (me !== undefined && !known.has(me)) {
        findings.push({
          code: 'UNKNOWN_ME',
          severity: 'warning',
          path: 'local.json',
          message: `Me "${me}" is not in the roster`,
          async fix(changes) {
            await changes.updateLocalState(({ me: _me, ...rest }) => rest);
            return `cleared me "${me}" from Local State`;
          },
        });
      }
      return findings;
    },
  },
  tui: () => import('./tui').then((m) => m.tui),
});
