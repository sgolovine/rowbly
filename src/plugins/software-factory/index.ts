import { definePlugin } from '../../plugin-api';
import { commands } from './commands';
import { doctor } from './doctor';
import { PLUGIN_ID, Settings } from './stagePrompts';
import { currentRun, endVisit, runText, StageRunBag } from './stageRuns';

export const softwareFactory = definePlugin({
  id: PLUGIN_ID,
  name: 'Software Factory',
  description: 'A Markdown Stage Prompt for each Stage, and the Stage Runs of the agents that work a Board',
  settings: Settings,
  bags: { story: StageRunBag },
  commands,
  hooks: {
    'stories.move': { transform: ({ changes, result, plugin }) => endVisit(changes, result.key, plugin) },
    'stories.update': { transform: ({ changes, result, plugin }) => endVisit(changes, result.key, plugin) },
  },
  async storyRows(story, plugin) {
    const run = currentRun(plugin, story);
    return run ? [{ label: 'Stage Run', value: runText(run) }] : [];
  },
  doctor,
  tui: () => import('./tui').then((m) => m.tui),
});
