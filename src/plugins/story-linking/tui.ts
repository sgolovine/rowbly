import type { PluginTui } from '../../plugin-api';
import { type LinkDraft, LinksCreateTab } from './LinksCreateTab';
import { LinksTab } from './LinksTab';
import { NewLinkForm } from './NewLinkForm';

export const tui: PluginTui = {
  screens: { new: NewLinkForm },
  storyCreateTabs: [
    {
      label: 'Links',
      component: LinksCreateTab,
      input: (draft) => ({
        blocks: (draft as LinkDraft[]).filter((l) => l.direction === 'blocks').map((l) => l.key),
        blockedBy: (draft as LinkDraft[]).filter((l) => l.direction === 'blocked-by').map((l) => l.key),
      }),
    },
  ],
  storyTabs: [{ label: 'Links', component: LinksTab }],
};
