import type { EventEmitter } from 'node:events';
import { useCallback, useMemo, useState } from 'react';
import { createServices, type RowblyContext, type Services } from '../services';
import {
  createMouseRegistry,
  createShellRegistry,
  createToastStore,
  MouseContext,
  PluginsContext,
  ServicesContext,
  ShellContext,
  ToastContext,
  type ToastStore,
  type TuiPlugin,
  useMouseSource,
} from './hooks';
import { type PluginLoader, withPlugins } from './loadPlugins';
import { type Route, RouterProvider } from './router';
import { screens as defaultScreens, type ScreenRegistry } from './screens';
import { Shell } from './shell';

export interface AppProps {
  ctx: RowblyContext | null;
  services: Services | null;
  initial: Route;
  /** Pass the store that `ctx.warn` feeds; a fresh one is made otherwise. */
  toasts?: ToastStore;
  screens?: ScreenRegistry;
  /** Emits the `mouse` events read by `MouseStdin`; without it the app is keyboard-only. */
  mouse?: EventEmitter;
  /** The Plugins that `ctx` has on, with their TUI parts loaded. */
  plugins?: readonly TuiPlugin[];
  /** Loads the Plugins of a context the app switches to, or loads again. */
  loadPlugins?: PluginLoader;
}

/** The whole TUI: providers around the shell. */
export function App({
  ctx,
  services,
  initial,
  toasts,
  screens = defaultScreens,
  mouse,
  plugins = [],
  loadPlugins,
}: AppProps) {
  const toastStore = useMemo(() => toasts ?? createToastStore(), [toasts]);
  const shell = useMemo(createShellRegistry, []);
  const mouseRegistry = useMemo(createMouseRegistry, []);
  useMouseSource(mouseRegistry, mouse);
  const [current, setCurrent] = useState({ ctx, services, plugins });
  /** Switches to `next` with fresh services, after loading its Plugins. */
  const activate = useCallback(
    async (next: RowblyContext) => {
      const loaded = await withPlugins(next, loadPlugins, toastStore);
      setCurrent({ ctx: next, services: createServices(next), plugins: loaded });
    },
    [loadPlugins, toastStore],
  );
  const servicesValue = useMemo(
    () => ({ ctx: current.ctx, services: current.services, activate: (next: RowblyContext) => void activate(next) }),
    [current, activate],
  );
  const pluginsValue = useMemo(
    () => ({
      plugins: current.plugins,
      reload: async () => {
        // A shallow copy, so loading the Plugins into it (`ctx.plugins`) leaves the context that the
        // screens use now as it is until the new one replaces it. It shares everything else (CQ-78).
        if (current.ctx) await activate({ ...current.ctx });
      },
    }),
    [current, activate],
  );
  return (
    <ServicesContext.Provider value={servicesValue}>
      <PluginsContext.Provider value={pluginsValue}>
        <ToastContext.Provider value={toastStore}>
          <ShellContext.Provider value={shell}>
            <MouseContext.Provider value={mouseRegistry}>
              <RouterProvider initial={initial}>
                <Shell screens={screens} />
              </RouterProvider>
            </MouseContext.Provider>
          </ShellContext.Provider>
        </ToastContext.Provider>
      </PluginsContext.Provider>
    </ServicesContext.Provider>
  );
}
