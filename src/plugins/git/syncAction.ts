import type { PluginAction } from '../../plugin-api';
import { preferences } from './model';

/**
 * Sync, in the header wherever Rowbly runs (ADR-0035): commits pending Rowbly data, rebases onto the
 * branch's upstream and pushes. The toast shows only after the push; a failure shows its cause.
 */
export const syncAction: PluginAction = {
  key: 'S',
  label: 'Sync',
  target: 'none',
  async run({ plugin, ui }) {
    const { authorName, authorEmail } = await preferences(plugin);
    const result = await plugin.git.sync({ authorName, authorEmail });
    const parts = [result.committed ? 'committed Rowbly changes' : 'no Rowbly changes to commit'];
    if (result.pulled) parts.push(`pulled ${result.pulled} commit${result.pulled === 1 ? '' : 's'}`);
    if (result.pushed) parts.push(`pushed ${result.pushed} commit${result.pushed === 1 ? '' : 's'}`);
    ui.toast(`Synced with ${result.upstream} · ${parts.join(' · ')}`);
  },
};
