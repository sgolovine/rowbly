import type { PluginTui } from '../../plugin-api';
import { GitCommitSettings } from './GitCommitSettings';
import { GitSettings } from './GitSettings';
import { GitSyncSettings } from './GitSyncSettings';

export const tui: PluginTui = {
  screens: { settings: GitSettings, commits: GitCommitSettings, synchronization: GitSyncSettings },
  settings: [{ label: 'Git', screen: 'settings' }],
};
