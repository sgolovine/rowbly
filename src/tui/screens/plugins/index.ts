import { PLUGIN_SCREEN } from '../../hooks';
import type { ScreenRegistry } from '../types';
import { PluginScreenHost } from './PluginScreenHost';
import { PluginsScreen } from './PluginsScreen';

export const pluginsScreens: ScreenRegistry = {
  plugins: PluginsScreen,
  [PLUGIN_SCREEN]: PluginScreenHost,
};
