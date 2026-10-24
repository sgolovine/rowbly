import { definePlugin } from '../../plugin-api';
import { commands } from './commands';
import { checkLinks, readLinks, unlinkDeleted } from './links';
import { LinksBag } from './model';

export const storyLinking = definePlugin({
  id: 'story-linking',
  name: 'Story Linking',
  description: 'Blocking relationships between Stories on the same Board',
  bags: { story: LinksBag },
  commands,
  hooks: {
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
