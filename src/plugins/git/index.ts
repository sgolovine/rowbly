import { definePlugin, z } from '../../plugin-api';
import { commands } from './commands';
import { Preferences, resolveCommitOptions } from './model';

export const git = definePlugin({
  id: 'git',
  name: 'Git',
  description: 'Automatically commit Rowbly changes to Git',
  settings: z.object({}),
  requiresGit: true,
  bags: { local: Preferences },
  async start({ git }) {
    await git.info();
    await git.resume(resolveCommitOptions);
  },
  async react({ changes, plugin }) {
    await plugin.git.changed(changes, resolveCommitOptions);
  },
  commands,
  tui: () => import('./tui').then((m) => m.tui),
});
