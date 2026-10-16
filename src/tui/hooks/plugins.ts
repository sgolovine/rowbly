import { createContext, useContext, useMemo } from 'react';
import type { PluginAction, PluginTui, PluginUi } from '../../services';
import { type Router, useRouter } from '../router';
import { type ToastStore, useToast } from './toasts';

/** A Plugin that is on, with its Actions and, once loaded, its TUI part. */
export interface TuiPlugin {
  id: string;
  tui: PluginTui<unknown>;
  actions: readonly PluginAction<unknown>[];
}

export interface PluginsValue {
  /** In registry order. */
  plugins: readonly TuiPlugin[];
  /** Loads the Plugins again, e.g. after one was turned on or off. */
  reload(): Promise<void>;
}

export const PluginsContext = createContext<PluginsValue>({ plugins: [], reload: async () => {} });

/** The Plugins that are on, for the slots that show what they add. */
export function usePlugins(): PluginsValue {
  return useContext(PluginsContext);
}

/** The route of a Plugin's screen: one `plugin` screen that shows `params.screen` of `params.plugin`. */
export const PLUGIN_SCREEN = 'plugin';

/**
 * The route of Plugin `id`'s `screen`. `params.title` is the breadcrumb, the screen name with a
 * capital letter by default; `plugin` and `screen` are route metadata that `params` cannot replace.
 */
export function pluginRoute(id: string, screen: string, params: Record<string, unknown> = {}) {
  return {
    screen: PLUGIN_SCREEN,
    params: { title: screen.charAt(0).toUpperCase() + screen.slice(1), ...params, plugin: id, screen },
  };
}

/** What Plugin `id`'s screens and Actions use to open and show things. */
export function pluginUi(id: string, router: Router, toasts: ToastStore): PluginUi {
  return {
    open(screen, params) {
      const route = pluginRoute(id, screen, params);
      router.push(route.screen, route.params);
    },
    // Core routes stay private: a Plugin names only the record, never the route (ARCH-07).
    openStory: (key) => router.push('story', { key, title: key }),
    openTask: (taskId) => router.push('task', { id: taskId, title: taskId }),
    openBoard: (boardId) => router.push('board-detail', { boardId, title: boardId }),
    back: () => router.pop(),
    toast: (message, kind = 'info') => toasts.push(kind, message),
    error: (err) => toasts.error(err),
  };
}

export function usePluginUi(id: string): PluginUi {
  const router = useRouter();
  const toasts = useToast();
  return useMemo(() => pluginUi(id, router, toasts), [id, router, toasts]);
}
