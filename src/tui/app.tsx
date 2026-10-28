import type { EventEmitter } from 'node:events';
import { useMemo } from 'react';
import type { RowblyContext, Services } from '../services';
import {
  createMouseRegistry,
  createShellRegistry,
  createToastStore,
  DataRootChangesContext,
  MouseContext,
  PluginsContext,
  ServicesContext,
  ShellContext,
  ToastContext,
  type ToastStore,
  type TuiPlugin,
  useDataRootSession,
  useDataRootWatch,
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
  /** Watch the open Data Root and reload what is on screen when it changes on disk. */
  watch?: boolean;
  /** Enable first-run routing when activating another Data Root. */
  onboarding?: boolean;
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
  watch = false,
  onboarding = false,
}: AppProps) {
  const toastStore = useMemo(() => toasts ?? createToastStore(), [toasts]);
  const shell = useMemo(createShellRegistry, []);
  const mouseRegistry = useMemo(createMouseRegistry, []);
  useMouseSource(mouseRegistry, mouse);
  const session = useDataRootSession({ ctx, services, plugins, initial, onboarding, loadPlugins, toasts: toastStore });
  // The Plugins that are on, and their settings, come from `rowbly.config.json` when they load.
  const changes = useDataRootWatch(watch ? session.services.ctx?.root : undefined, toastStore, (paths) => {
    if (!paths || paths.includes('rowbly.config.json')) void session.plugins.reload();
  });
  return (
    <ServicesContext.Provider value={session.services}>
      <PluginsContext.Provider value={session.plugins}>
        <DataRootChangesContext.Provider value={changes}>
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
        </DataRootChangesContext.Provider>
      </PluginsContext.Provider>
    </ServicesContext.Provider>
  );
}
