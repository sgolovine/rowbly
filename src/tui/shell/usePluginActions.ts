import { useContext, useEffect, useMemo, useRef, useState } from 'react';
import { type ActionFocus, invokePlugin, type PluginAction } from '../../services';
import { pluginUi, ServicesContext, usePlugins, useToast } from '../hooks';
import { useRouter } from '../router';
import { bindAction } from './actionFocus';
import type { HeaderAction } from './Header';

/** Mounted Action status and runs, scoped to the current host and Data Root (ADR-0035 §1). */
export function usePluginActions(focus: ActionFocus | null): HeaderAction[] {
  const { services } = useContext(ServicesContext);
  const { plugins } = usePlugins();
  const router = useRouter(),
    toast = useToast();
  const [, refresh] = useState(0);
  // Pending belongs to the Action/host, so changing focus during a run cannot admit another run.
  // biome-ignore lint/correctness/useExhaustiveDependencies: replacing the host invalidates all pending UI adapters.
  const session = useMemo(
    () => ({
      pending: new Set<PluginAction<unknown>>(),
      reading: new Set<PluginAction<unknown>>(),
      failed: new Set<PluginAction<unknown>>(),
      loaded: new Map<PluginAction<unknown>, { focus: ActionFocus | null; label?: string; busy?: boolean }>(),
      live: true,
    }),
    [services, plugins],
  );
  const latest = useRef(session),
    latestFocus = useRef(focus);
  latest.current = session;
  latestFocus.current = focus;
  const current = () => session.live && latest.current === session;
  useEffect(() => {
    session.live = true;
    return () => {
      session.live = false;
    };
  }, [session]);

  // Each callback has at most one read in flight, including across focus changes. Polling has no run path.
  useEffect(() => {
    let mounted = true;
    const poll = () => {
      if (!services) return;
      for (const plugin of plugins)
        for (const action of plugin.actions) {
          const bound = bindAction(action, focus);
          const read = bound?.status;
          if (!read || session.reading.has(action)) continue;
          session.reading.add(action);
          void invokePlugin({ plugin: plugin.id, stage: 'status' }, () => read(services.plugins.context(plugin.id)))
            .then(
              (value) => {
                if (!mounted || !session.live || latest.current !== session || latestFocus.current !== focus) return;
                const previous = session.loaded.get(action);
                session.loaded.set(action, { ...value, focus });
                if (previous?.focus !== focus || previous?.label !== value.label || previous?.busy !== value.busy)
                  refresh((n) => n + 1);
              },
              (error: unknown) => {
                if (
                  !mounted ||
                  !session.live ||
                  latest.current !== session ||
                  latestFocus.current !== focus ||
                  session.failed.has(action)
                )
                  return;
                session.failed.add(action);
                toast.error(error);
              },
            )
            .finally(() => session.reading.delete(action));
        }
    };
    poll();
    const timer = setInterval(poll, 250);
    return () => {
      mounted = false;
      clearInterval(timer);
    };
  }, [services, plugins, session, focus, toast]);

  return services
    ? plugins.flatMap((plugin) =>
        plugin.actions.flatMap((action) => {
          const bound = bindAction(action, focus);
          if (!bound) return [];
          const loaded = session.loaded.get(action);
          const status = loaded?.focus === focus ? loaded : undefined;
          const pending = session.pending.has(action);
          return [
            {
              key: action.key,
              label: pending && !status?.busy ? `${action.label}: waiting` : (status?.label ?? action.label),
              busy: pending || status?.busy === true,
              run() {
                if (
                  !current() ||
                  latestFocus.current !== focus ||
                  session.pending.has(action) ||
                  (session.loaded.get(action)?.focus === focus && session.loaded.get(action)?.busy)
                )
                  return;
                session.pending.add(action);
                refresh((n) => n + 1);
                const ui = pluginUi(plugin.id, router, toast, current);
                void invokePlugin({ plugin: plugin.id, stage: 'screen' }, () =>
                  bound.run({ plugin: services.plugins.context(plugin.id), ui }),
                )
                  .catch((error: unknown) => {
                    if (current()) toast.error(error);
                  })
                  .finally(() => {
                    session.pending.delete(action);
                    if (current()) refresh((n) => n + 1);
                  });
              },
            },
          ];
        }),
      )
    : [];
}
