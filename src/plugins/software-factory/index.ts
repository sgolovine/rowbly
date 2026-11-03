import { definePlugin } from '../../plugin-api';
import { commands } from './commands';
import { doctor } from './doctor';
import { guardTouchedRun } from './heartbeat';
import { holdText, readHold } from './holds';
import { metadataOutput, readRunMetadata } from './runMetadata';
import { PLUGIN_ID, Settings } from './stagePrompts';
import { currentRun, endVisit, guardFinishedRun, MoveInput, parseRunRef, runText, StageRunBag } from './stageRuns';
import { guardAttachedWorker, guardStartedRun } from './workerIdentity';

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
    'software-factory.start': { guard: ({ plugin, changes, result }) => guardStartedRun(plugin, changes, result) },
    'software-factory.attach': { guard: ({ plugin, changes, result }) => guardAttachedWorker(plugin, changes, result) },
    'software-factory.touch': { guard: ({ plugin, changes, result }) => guardTouchedRun(plugin, changes, result) },
    'stories.move': {
      transform: ({ changes, result, plugin }) => endVisit(changes, result.key, plugin),
      guard: ({ changes, result, pluginInput, plugin }) => guardFinishedRun(changes, result.key, pluginInput, plugin),
    },
    'stories.update': { transform: ({ changes, result, plugin }) => endVisit(changes, result.key, plugin) },
  },
  async storyRows(story, plugin) {
    const run = currentRun(plugin, story);
    const hold = await readHold(plugin, story.key);
    const metadata = metadataOutput(await readRunMetadata(plugin, story));
    const rows = run ? [{ label: 'Stage Run', value: runText(run) }] : [];
    if (metadata.status === 'invalid' || metadata.status === 'unsupported')
      rows.push({ label: 'Run details', value: 'unavailable; run rowbly doctor' });
    else if (metadata.identity) {
      const i = metadata.identity;
      rows.push({
        label: 'Worker identity',
        value: `${i.machine} / ${i.harness} / ${i.threadId} (attested: ${i.verification.source})`,
      });
    }
    if (hold.kind !== 'none') rows.push({ label: 'Hold', value: holdText(hold) });
    return rows;
  },
  doctor,
  tui: () => import('./tui').then((m) => m.tui),
});
