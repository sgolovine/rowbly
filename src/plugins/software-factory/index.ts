import { definePlugin } from '../../plugin-api';
import { commands } from './commands';
import { doctor } from './doctor';
import { holdText, readHold } from './holds';
import { PLUGIN_ID, Settings } from './stagePrompts';
import { currentRun, endVisit, guardFinishedRun, MoveInput, parseRunRef, runText, StageRunBag } from './stageRuns';

export const softwareFactory = definePlugin({
  id: PLUGIN_ID,
  name: 'Software Factory',
  description: 'A Markdown Stage Prompt for each Stage, and the Stage Runs of the agents that work a Board',
  settings: Settings,
  bags: { story: StageRunBag },
  commands,
  inputs: { 'stories.move': MoveInput },
  options: {
    'stories move': {
      options: [
        {
          flags: '--finished-run <stage/attempt/startedAt>',
          description: "move only while this is the visit's finished Stage Run",
        },
      ],
      input: ({ finishedRun }) =>
        finishedRun === undefined ? undefined : { finishedRun: parseRunRef(String(finishedRun)) },
    },
  },
  hooks: {
    'stories.move': {
      transform: ({ changes, result, plugin }) => endVisit(changes, result.key, plugin),
      guard: ({ changes, result, pluginInput, plugin }) => guardFinishedRun(changes, result.key, pluginInput, plugin),
    },
    'stories.update': { transform: ({ changes, result, plugin }) => endVisit(changes, result.key, plugin) },
  },
  async storyRows(story, plugin) {
    const run = currentRun(plugin, story);
    const hold = await readHold(plugin, story.key);
    return [
      ...(run ? [{ label: 'Stage Run', value: runText(run) }] : []),
      ...(hold.kind !== 'none' ? [{ label: 'Hold', value: holdText(hold) }] : []),
    ];
  },
  doctor,
  tui: () => import('./tui').then((m) => m.tui),
});
