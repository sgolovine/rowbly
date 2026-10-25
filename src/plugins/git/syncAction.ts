import type { PluginAction } from '../../plugin-api';
import { resolveSyncOptions } from './model';

/**
 * Sync, in the header wherever Rowbly runs (ADR-0035): commits pending Rowbly data, rebases onto the
 * branch's upstream and pushes. The toast shows only after the push; a failure shows its cause.
 */
export const syncAction: PluginAction = {
  key: 'S',
  label: 'Sync',
  target: 'none',
  async run({ plugin, ui }) {
    const result = await plugin.git.requestSync(resolveSyncOptions, 'rebase');
    if (result.last?.kind !== 'synchronized') throw new Error(result.last?.message ?? 'Sync did not finish');
    ui.toast(`Synced with ${result.last.upstream}`);
  },
};
