// #region scoped-settings
import type { PluginTui } from '../../../src/plugin-api';

export const scopedSettings: PluginTui = {
  screens: { settings: () => null },
  settings: [{ label: 'Prompts', screen: 'settings', scopes: ['global', 'board'] }],
};
// #endregion
