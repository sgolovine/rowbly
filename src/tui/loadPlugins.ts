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
  stage?: (plugin: ActivePlugin, active: readonly ActivePlugin[]) => Promise<void>,
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
  // `active()` returns a copy, so `markFailed` below cannot disturb this loop (CQ-56).
  for (const { definition } of host.active()) {
    try {
      const tui = staged.get(definition.id) ?? (await importTui(definition));
      const claimant = loaded.find((p) => p.tui.storyPaste);
      if (tui.storyPaste && claimant) throw new Error(`storyPaste is already claimed by Plugin "${claimant.id}"`);
      loaded.push({ id: definition.id, tui, actions: definition.actions ?? [] });
    } catch (err) {
      host.markFailed(definition.id, err instanceof Error ? err.message : String(err));
    }
  }
  return loaded;
}

async function importTui(definition: ActivePlugin['definition']): Promise<PluginTui<unknown>> {
  let tui: PluginTui<unknown>;
  try {
    tui = definition.tui ? await definition.tui() : {};
  } catch (err) {
    throw new Error(`its TUI part failed: ${err instanceof Error ? err.message : String(err)}`);
  }
  const problem = tuiProblem(tui);
  if (problem) throw new Error(`its TUI part is invalid: ${problem}`);
  return tui;
}

/**
 * What is wrong with a TUI part's declarations, if anything (ARCH-40): a Home entry, settings
 * section or sidebar button that opens a screen the Plugin does not have, or two settings sections or tabs of one
 * kind with the same label. Field names are checked when the fields load.
 */
function tuiProblem(tui: PluginTui<unknown>): string | undefined {
  if (
    tui.storyPaste &&
    ['story', 'form', 'input'].some((key) => typeof tui.storyPaste?.[key as keyof typeof tui.storyPaste] !== 'function')
  ) {
    return 'storyPaste must declare story, form and input callbacks';
  }
  const screens = tui.screens ?? {};
  const links = [
    ...(tui.home ?? []).map((link) => ({ kind: 'Home entry', ...link })),
    ...(tui.settings ?? []).map((link) => ({ kind: 'settings section', ...link })),
    ...(tui.sidebar?.create ? [{ kind: 'sidebar button', ...tui.sidebar.create }] : []),
  ];
  for (const link of links) {
    if (!Object.hasOwn(screens, link.screen)) {
      return `its ${link.kind} "${link.label}" opens screen "${link.screen}", which it does not have`;
    }
  }
  const labelled = [
    { kind: 'settings sections', labels: (tui.settings ?? []).map((link) => link.label) },
    { kind: 'Story tabs', labels: (tui.storyTabs ?? []).map((tab) => tab.label) },
  ];
  for (const { kind, labels } of labelled) {
    const twice = labels.find((label, i) => labels.indexOf(label) !== i);
    if (twice !== undefined) return `it has two ${kind} labelled "${twice}"`;
  }
  return undefined;
}

/**
 * The load failures already shown as toasts in each TUI session, keyed by its toast store (one per
 * `startTui`), as `<Data Root>\0<Plugin ID>\0<reason>`.
 */
const warnedBySession = new WeakMap<ToastStore, Set<string>>();

/**
 * Shows each of `host`'s load failures as a toast once per session (RES-20). Loading again, as after
 * turning a Plugin on or off, does not repeat a warning. A failure warns again when its reason
 * changes, or when it went away (the Plugin loaded, or was turned off) and came back. Another Data
 * Root's failures warn on their own. The Plugins status shows every failure, every time.
 */
function warnFailures(root: DataRoot | null, host: PluginHost, toasts: ToastStore): void {
  const warned = warnedBySession.get(toasts) ?? new Set<string>();
  warnedBySession.set(toasts, warned);
  const prefix = `${root?.path ?? ''}\0`;
  const current = new Set(host.failures().map((failure) => `${prefix}${failure.id}\0${failure.reason ?? ''}`));
  for (const key of warned) if (key.startsWith(prefix) && !current.has(key)) warned.delete(key);
  for (const failure of host.failures()) {
    const key = `${prefix}${failure.id}\0${failure.reason ?? ''}`;
    if (warned.has(key)) continue;
    warned.add(key);
    toasts.push('warning', failureWarning(failure));
  }
}

/**
 * Gets `ctx` ready for the TUI and returns its Plugins with their TUI parts loaded. With a loader, it
 * loads `ctx`'s Plugins into it anew, importing each Plugin's TUI part while it loads, so one that
 * fails keeps no names from later Plugins (RES-22). Without one, it loads the TUI parts of the host
 * `ctx` already has. Either way reactions then run in the background, so the TUI never waits for
 * them, and each load failure shows as a toast once per session (RES-23).
 */
export async function withPlugins(
  ctx: RowblyContext,
  load: PluginLoader | undefined,
  toasts: ToastStore,
): Promise<TuiPlugin[]> {
  const staged = new Map<string, PluginTui<unknown>>();
  if (load) {
    ctx.plugins = await load(ctx.root, async ({ definition }, active) => {
      const tui = await importTui(definition);
      // Only successfully started Plugins own a claim (ADR-0020 §8).
      const claimant = active.find((p) => staged.get(p.definition.id)?.storyPaste);
      if (tui.storyPaste && claimant) {
        throw new Error(`storyPaste is already claimed by Plugin "${claimant.definition.id}"`);
      }
      staged.set(definition.id, tui);
    });
  }
  ctx.backgroundReactions = true;
  if (!ctx.plugins) return [];
  const plugins = await loadTuiPlugins(ctx.plugins, staged);
  warnFailures(ctx.root, ctx.plugins, toasts);
  return plugins;
}
