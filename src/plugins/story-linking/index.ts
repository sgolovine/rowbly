import { definePlugin, parseStoryKey, ValidationError } from '../../plugin-api';
import { commands } from './commands';
import { applyCreateLinks, checkLinks, readLinks, unlinkDeleted } from './links';
import { LinksBag, LinksCreateInput } from './model';
import { reconcile } from './reconcile';

export const storyLinking = definePlugin({
  reconcile,
  id: 'story-linking',
  name: 'Story Linking',
  description: 'Blocking relationships between Stories on the same Board',
  bags: { story: LinksBag },
  commands,
  inputs: { 'stories.create': LinksCreateInput },
  options: {
    'stories create': {
      options: [
        { flags: '--blocks <key>', description: 'Story this Story blocks (repeatable)', repeatable: true },
        { flags: '--blocked-by <key>', description: 'Story blocking this Story (repeatable)', repeatable: true },
      ],
      input({ blocks, blockedBy }) {
        if (blocks === undefined && blockedBy === undefined) return undefined;
        const keys = (value: typeof blocks) =>
          value === undefined
            ? undefined
            : (Array.isArray(value) ? value : [String(value)]).map((key) => {
                try {
                  return parseStoryKey(key).key;
                } catch {
                  throw new ValidationError(`invalid Story Key "${key}"`);
                }
              });
        return { blocks: keys(blocks), blockedBy: keys(blockedBy) };
      },
    },
  },
  hooks: {
    'stories.create': {
      transform: ({ changes, result, pluginInput, plugin }) => applyCreateLinks(changes, result, pluginInput, plugin),
    },
    'stories.remove': {
      transform: ({ changes, plugin }) => unlinkDeleted(changes, plugin),
    },
  },
  async storyRows(story, plugin) {
    const view = await readLinks(plugin, story.key);
    const invalid = view.unavailable.length ? `unavailable (invalid: ${view.unavailable.join(', ')})` : undefined;
    return [
      {
        label: 'Blocks',
        value: view.unavailable.includes(story.key)
          ? (invalid as string)
          : view.links
              .filter((link) => link.relation === 'blocks')
              .map((link) => link.key)
              .join(', ') || '—',
      },
      {
        label: 'Blocked by',
        value:
          invalid ??
          (view.links
            .filter((link) => link.relation === 'blocked-by')
            .map((link) => link.key)
            .join(', ') ||
            '—'),
      },
    ];
  },
  doctor: { check: ({ data, plugin }) => checkLinks(plugin, data.stories) },
  tui: () => import('./tui').then((m) => m.tui),
});
