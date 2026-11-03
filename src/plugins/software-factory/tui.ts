import type { PluginTui } from '../../plugin-api';
import { StagePromptHeader } from './StagePromptHeader';
import { StagePromptsScreen } from './StagePromptsScreen';
import { StageRunTab } from './StageRunTab';
import { currentRun } from './stageRuns';

export const tui: PluginTui = {
  stageHeader: StagePromptHeader,
  screens: { 'stage-prompts': StagePromptsScreen },
  settings: [{ label: 'Stage Prompts', screen: 'stage-prompts', scopes: ['global', 'board'] }],
  storyTabs: [{ label: 'Stage Run', component: StageRunTab }],
  /** `▶ running` or `✕ failed` for this visit's Stage Run, with `#n` after the first attempt. */
  cardBadge({ story, plugin }) {
    const run = currentRun(plugin, story);
    if (!run || run.status === 'finished') return null;
    const attempt = run.attempt > 1 ? ` #${run.attempt}` : '';
    return `${run.status === 'running' ? '▶' : '✕'} ${run.status}${attempt}`;
  },
};
