import { type DataRoot, failureWarning, type PluginHost, type RowblyContext } from '../services';
import type { ToastStore, TuiPlugin } from './hooks';

/** Loads the Plugins of a Data Root for the TUI (the entry point binds the registry). */
export type PluginLoader = (root: DataRoot | null) => Promise<PluginHost>;

/**
 * Loads the TUI part of each Plugin that is on (ADR-0009: only now that the TUI starts). A Plugin
 * whose TUI part throws while it loads fails to load like any other.
 */
export async function loadTuiPlugins(host: PluginHost): Promise<TuiPlugin[]> {
  const loaded: TuiPlugin[] = [];
  for (const { definition } of [...host.active()]) {
    try {
      const tui = definition.tui ? await definition.tui() : {};
      loaded.push({ id: definition.id, tui, actions: definition.actions ?? [] });
    } catch (err) {
      host.markFailed(definition.id, `its TUI part failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
  return loaded;
}

/**
 * Loads `ctx`'s Plugins into it (without a loader, it keeps the ones it has) (reactions then run in the background, so the TUI never waits for
 * them), and warns once, as toasts, about each one that failed to load.
 */
export async function withPlugins(
  ctx: RowblyContext,
  load: PluginLoader | undefined,
  toasts: ToastStore,
): Promise<TuiPlugin[]> {
  if (!load) return ctx.plugins ? loadTuiPlugins(ctx.plugins) : [];
  ctx.plugins = await load(ctx.root);
  ctx.backgroundReactions = true;
  const plugins = await loadTuiPlugins(ctx.plugins);
  for (const failure of ctx.plugins.failures()) toasts.push('warning', failureWarning(failure));
  return plugins;
}
