import {
  type ActivePlugin,
  type DataRoot,
  failureWarning,
  type PluginHost,
  type PluginTui,
  type RowblyContext,
} from '../services';
import type { ToastStore, TuiPlugin } from './hooks';

/**
 * Loads the Plugins of a Data Root for the TUI (the entry point binds the registry). `stage` runs
 * for each Plugin while it loads (`LoadPluginsOptions.stage`).
 */
export type PluginLoader = (
  root: DataRoot | null,
  stage?: (plugin: ActivePlugin) => Promise<void>,
) => Promise<PluginHost>;

/**
 * Loads the TUI part of each Plugin that is on (ADR-0009: only now that the TUI starts), unless
 * `staged` already has it. A Plugin whose TUI part throws while it loads fails to load like any
 * other; a Plugin rejected earlier for a clash with it is not retried (ADR-0020 §8).
 */
export async function loadTuiPlugins(
  host: PluginHost,
  staged: ReadonlyMap<string, PluginTui<unknown>> = new Map(),
): Promise<TuiPlugin[]> {
  const loaded: TuiPlugin[] = [];
  for (const { definition } of host.active()) {
    try {
      const tui = staged.get(definition.id) ?? (await importTui(definition));
      loaded.push({ id: definition.id, tui, actions: definition.actions ?? [] });
    } catch (err) {
      host.markFailed(definition.id, err instanceof Error ? err.message : String(err));
    }
  }
  return loaded;
}

async function importTui(definition: ActivePlugin['definition']): Promise<PluginTui<unknown>> {
  try {
    return definition.tui ? await definition.tui() : {};
  } catch (err) {
    throw new Error(`its TUI part failed: ${err instanceof Error ? err.message : String(err)}`);
  }
}

/**
 * Loads `ctx`'s Plugins into it (without a loader, it keeps the ones it has) (reactions then run in the background, so the TUI never waits for
 * them), and warns once, as toasts, about each one that failed to load. With a loader, each Plugin's
 * TUI part is imported while it loads, so one that fails keeps no names from later Plugins (RES-22).
 */
export async function withPlugins(
  ctx: RowblyContext,
  load: PluginLoader | undefined,
  toasts: ToastStore,
): Promise<TuiPlugin[]> {
  if (!load) return ctx.plugins ? loadTuiPlugins(ctx.plugins) : [];
  const staged = new Map<string, PluginTui<unknown>>();
  ctx.plugins = await load(ctx.root, async ({ definition }) => {
    staged.set(definition.id, await importTui(definition));
  });
  ctx.backgroundReactions = true;
  const plugins = await loadTuiPlugins(ctx.plugins, staged);
  for (const failure of ctx.plugins.failures()) toasts.push('warning', failureWarning(failure));
  return plugins;
}
