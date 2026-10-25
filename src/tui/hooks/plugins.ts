import { createContext, useContext, useMemo } from 'react';
import type { Story } from '../../schemas';
import type { PluginAction, PluginTui, PluginUi, Services } from '../../services';
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
export function pluginUi(id: string, router: Router, toasts: ToastStore, current = () => true): PluginUi {
  return {
    open(screen, params) {
      if (!current()) return;
      const route = pluginRoute(id, screen, params);
      router.push(route.screen, route.params);
    },
    // Core routes stay private: a Plugin names only the record, never the route (ARCH-07).
    openStory: (key) => {
      if (current()) router.push('story', { key, title: key });
    },
    openBoard: (boardId) => {
      if (current()) router.push('board-detail', { boardId, title: boardId });
    },
    back: () => {
      if (current()) router.pop();
    },
    toast: (message, kind = 'info') => {
      if (current()) toasts.push(kind, message);
    },
    error: (err) => {
      if (current()) toasts.error(err);
    },
  };
}

export function usePluginUi(id: string): PluginUi {
  const router = useRouter();
  const toasts = useToast();
  return useMemo(() => pluginUi(id, router, toasts), [id, router, toasts]);
}

/** A Story's badges from the Plugins that are on. */
export type StoryBadges = (story: Story) => string[];

/**
 * Loads the badges the Plugins that are on show for a Story, in registry order: each Plugin's
 * `PluginTui.storyBadges`, then what its `loadStoryBadges` returns. A screen loads them with its Stories,
 * so they follow its reloads. A Plugin whose badges or load throw shows none: they only show something.
 */
export async function loadStoryBadges(plugins: readonly TuiPlugin[], services: Services): Promise<StoryBadges> {
  const perPlugin = await Promise.all(
    plugins.map(async ({ id, tui }) => {
      // One context per Plugin, not per Story.
      const plugin = services.plugins.context(id);
      const { storyBadges, loadStoryBadges } = tui;
      const badgers: StoryBadges[] = storyBadges ? [(story) => storyBadges({ story, plugin })] : [];
      if (loadStoryBadges) {
        try {
          badgers.push(await loadStoryBadges({ plugin }));
        } catch {}
      }
      return badgers;
    }),
  );
  const badgers = perPlugin.flat();
  return (story) =>
    badgers.flatMap((badges) => {
      try {
        return badges(story);
      } catch {
        return [];
      }
    });
}
