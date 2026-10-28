import type { PluginTui } from '../../plugin-api';
import { StagePromptHeader } from './StagePromptHeader';
import { StagePromptsScreen } from './StagePromptsScreen';

export const tui: PluginTui = {
  stageHeader: StagePromptHeader,
  screens: { 'stage-prompts': StagePromptsScreen },
  settings: [{ label: 'Stage Prompts', screen: 'stage-prompts' }],
};
