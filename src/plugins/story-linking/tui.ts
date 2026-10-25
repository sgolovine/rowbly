import type { PluginTui } from '../../plugin-api';
import { LinksTab } from './LinksTab';
import { NewLinkForm } from './NewLinkForm';

export const tui: PluginTui = {
  screens: { new: NewLinkForm },
  storyTabs: [{ label: 'Links', component: LinksTab }],
};
