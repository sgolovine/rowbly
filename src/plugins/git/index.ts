import { definePlugin, z } from '../../plugin-api';
import { commands } from './commands';
import { Preferences, preferences } from './model';

export const git = definePlugin({
  id: 'git',
  name: 'Git',
  description: 'Automatically commit Rowbly changes to Git',
  settings: z.object({}),
  requiresGit: true,
  bags: { local: Preferences },
  async start({ git, localData }) {
    await git.info();
    await git.resume(await preferences({ localData }));
  },
  async react({ changes, plugin }) {
    await plugin.git.changed(changes, await preferences(plugin));
  },
  commands,
  tui: () => import('./tui').then((m) => m.tui),
});
