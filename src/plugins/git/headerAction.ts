import type { PluginAction } from '../../plugin-api';
import { resolveSyncOptions } from './model';

/** Manual intent is independent of both automatic preferences; success follows this exact push. */
export const syncAction: PluginAction = {
  key: 'S',
  label: 'Sync',
  target: 'none',
  async status({ plugin }) {
    const state = await plugin.git.syncStatus(resolveSyncOptions);
    const busy = !!(state.manual || state.requested || state.active);
    const phase = state.active?.phase;
    const progress = phase === 'admitted' ? 'waiting' : phase === 'preparing' ? 'committing' : phase;
    return { label: busy ? `Sync: ${progress ?? 'waiting'}` : 'Sync', busy };
  },
  async run({ plugin, ui }) {
    await plugin.git.requestRebaseSync(resolveSyncOptions);
    ui.toast('Synchronized with upstream');
  },
};
