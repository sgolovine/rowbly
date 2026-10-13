import { PLUGIN_SCREEN } from '../../hooks';
import type { ScreenRegistry } from '../types';
import { PluginScreen } from './PluginScreen';
import { PluginsScreen } from './PluginsScreen';

export const pluginsScreens: ScreenRegistry = {
  plugins: PluginsScreen,
  [PLUGIN_SCREEN]: PluginScreen,
};
