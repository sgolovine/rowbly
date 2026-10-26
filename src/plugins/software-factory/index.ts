import { definePlugin } from '../../plugin-api';
import { commands } from './commands';
import { doctor } from './doctor';
import { PLUGIN_ID, Settings } from './stagePrompts';

export const softwareFactory = definePlugin({
  id: PLUGIN_ID,
  name: 'Software Factory',
  description: 'A Markdown Stage Prompt for each Stage, for agents that work a Board',
  settings: Settings,
  commands,
  doctor,
  tui: () => import('./tui').then((m) => m.tui),
});
