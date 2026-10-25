import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createServices, type RowblyContext, type Services } from '../../services';
import { type PluginLoader, withPlugins } from '../loadPlugins';
import type { Route } from '../router';
import type { TuiPlugin } from './plugins';
import type { ToastStore } from './toasts';

/** Where the app opens after switching to another Data Root. */
const HOME: Route = { screen: 'home', params: {} };

/**
 * The Data Root the app has open, with its services and Plugins. `activate` switches to another
 * context once its Plugins load; the last call wins, so one that settles late never takes the app
 * back. Switching to another Data Root changes `key`, which the caller puts on the router, so the
 * screens, filters and sidebar picks of the previous Data Root go and the new one opens at `initial`.
 */
export function useDataRootSession(opts: {
  ctx: RowblyContext | null;
  services: Services | null;
  plugins: readonly TuiPlugin[];
  initial: Route;
  loadPlugins: PluginLoader | undefined;
  toasts: ToastStore;
}) {
  const { loadPlugins, toasts } = opts;
  const [current, setCurrent] = useState({ ctx: opts.ctx, services: opts.services, plugins: opts.plugins, key: 0 });
  const latest = useRef(0);
  useEffect(
    () => () => {
      latest.current += 1;
    },
    [],
  );
  useEffect(() => {
    const host = current.ctx?.plugins;
    return () => host?.dispose?.();
  }, [current.ctx?.plugins]);
  const activate = useCallback(
    async (next: RowblyContext) => {
      latest.current += 1;
      const run = latest.current;
      const loaded = await withPlugins(next, loadPlugins, toasts);
      if (run !== latest.current) {
        next.plugins?.dispose?.();
        return false;
      }
      setCurrent((was) => ({
        ctx: next,
        services: createServices(next),
        plugins: loaded,
        key: was.ctx?.root.path === next.root.path ? was.key : was.key + 1,
      }));
      return true;
    },
    [loadPlugins, toasts],
  );
  const services = useMemo(() => ({ ctx: current.ctx, services: current.services, activate }), [current, activate]);
  const plugins = useMemo(
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
  return { services, plugins, key: current.key, initial: current.key === 0 ? opts.initial : HOME };
}
