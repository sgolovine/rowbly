import type { PluginTui } from '../../plugin-api';
import { type LinkDraft, LinksCreateTab } from './LinksCreateTab';
import { LinksTab } from './LinksTab';
import { readLinks } from './links';
import { LinksBag } from './model';
import { NewLinkForm } from './NewLinkForm';

export const tui: PluginTui = {
  storySearchText: ({ story, plugin }) => plugin.readBag(story, LinksBag)?.blocks ?? [],
  screens: { new: NewLinkForm },
  storyCreateTabs: [
    {
      label: 'Links',
      edit: {
        async load({ story, plugin }) {
          const view = await readLinks(plugin, story.key);
          if (view.unavailable.length)
            throw new Error(`Links unavailable: invalid data on ${view.unavailable.join(', ')}`);
          return view.links.map((l) => ({ direction: l.relation, key: l.key }));
        },
        input: (draft, initialDraft) => ({
          baseline: {
            blocks: (initialDraft as LinkDraft[]).filter((l) => l.direction === 'blocks').map((l) => l.key),
            blockedBy: (initialDraft as LinkDraft[]).filter((l) => l.direction === 'blocked-by').map((l) => l.key),
          },
          blocks: (draft as LinkDraft[]).filter((l) => l.direction === 'blocks').map((l) => l.key),
          blockedBy: (draft as LinkDraft[]).filter((l) => l.direction === 'blocked-by').map((l) => l.key),
        }),
      },
      component: LinksCreateTab,
      input: (draft) => ({
        blocks: (draft as LinkDraft[]).filter((l) => l.direction === 'blocks').map((l) => l.key),
        blockedBy: (draft as LinkDraft[]).filter((l) => l.direction === 'blocked-by').map((l) => l.key),
      }),
    },
  ],
  storyTabs: [{ label: 'Links', component: LinksTab }],
};
