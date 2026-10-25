import { definePlugin, z } from '../../plugin-api';
import { commands } from './commands';
import { Preferences, preferences } from './model';
import { syncAction } from './syncAction';

export const git = definePlugin({
  id: 'git',
  name: 'Git',
  description: 'Automatically commit Rowbly changes to Git, and sync them with the upstream',
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
  actions: [syncAction],
  tui: () => import('./tui').then((m) => m.tui),
});
