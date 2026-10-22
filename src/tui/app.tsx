import type { EventEmitter } from 'node:events';
import { useMemo } from 'react';
import type { RowblyContext, Services } from '../services';
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
  useDataRootSession,
  useMouseSource,
} from './hooks';
import type { PluginLoader } from './loadPlugins';
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
  const session = useDataRootSession({ ctx, services, plugins, initial, loadPlugins, toasts: toastStore });
  return (
    <ServicesContext.Provider value={session.services}>
      <PluginsContext.Provider value={session.plugins}>
        <ToastContext.Provider value={toastStore}>
          <ShellContext.Provider value={shell}>
            <MouseContext.Provider value={mouseRegistry}>
              {/* Keyed by the Data Root: switching to another one drops the previous one's screens and picks. */}
              <RouterProvider key={session.key} initial={session.initial}>
                <Shell screens={screens} />
              </RouterProvider>
            </MouseContext.Provider>
          </ShellContext.Provider>
        </ToastContext.Provider>
      </PluginsContext.Provider>
    </ServicesContext.Provider>
  );
}
