import type { EventEmitter } from 'node:events';
import { useMemo, useState } from 'react';
import { createServices, type RowblyContext, type Services } from '../services';
import {
  createMouseRegistry,
  createShellRegistry,
  createToastStore,
  MouseContext,
  ServicesContext,
  ShellContext,
  ToastContext,
  type ToastStore,
  useMouseSource,
} from './hooks';
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
}

/** The whole TUI: providers around the shell. */
export function App({ ctx, services, initial, toasts, screens = defaultScreens, mouse }: AppProps) {
  const toastStore = useMemo(() => toasts ?? createToastStore(), [toasts]);
  const shell = useMemo(createShellRegistry, []);
  const mouseRegistry = useMemo(createMouseRegistry, []);
  useMouseSource(mouseRegistry, mouse);
  const [current, setCurrent] = useState({ ctx, services });
  const servicesValue = useMemo(
    () => ({
      ...current,
      activate: (next: RowblyContext) => setCurrent({ ctx: next, services: createServices(next) }),
    }),
    [current],
  );
  return (
    <ServicesContext.Provider value={servicesValue}>
      <ToastContext.Provider value={toastStore}>
        <ShellContext.Provider value={shell}>
          <MouseContext.Provider value={mouseRegistry}>
            <RouterProvider initial={initial}>
              <Shell screens={screens} />
            </RouterProvider>
          </MouseContext.Provider>
        </ShellContext.Provider>
      </ToastContext.Provider>
    </ServicesContext.Provider>
  );
}
