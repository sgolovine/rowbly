import type { PluginTui } from '../../plugin-api';
import { StagePromptsScreen } from './StagePromptsScreen';

export const tui: PluginTui = {
  screens: { 'stage-prompts': StagePromptsScreen },
  settings: [{ label: 'Stage Prompts', screen: 'stage-prompts' }],
};
