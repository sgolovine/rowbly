import type { PluginTui } from '../../plugin-api';
import { GitSettings } from './GitSettings';

export const tui: PluginTui = {
  screens: { settings: GitSettings },
  settings: [{ label: 'Git', screen: 'settings' }],
};
