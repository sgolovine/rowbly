import { useContext, useEffect, useMemo, useRef, useState } from 'react';
import { invokePlugin, invokePluginSync, type PluginInput, type PluginSidebar } from '../../services';
import {
  pluginUi,
  ServicesContext,
  type SidebarFilter,
  useAsync,
  useContextMenu,
  useDataRootChanges,
  usePlugins,
  useToast,
} from '../hooks';
import { useRouter } from '../router';
import type { SidebarEntry } from './Sidebar';

/** The first entry of every Plugin Sidebar: no filter. No `value` a Plugin gives can be it. */
export const ALL_ENTRY = '\0all';

/** A picked entry, with the Plugin filter it stands for. */
interface Pick {
  value: string;
  label: string;
  filter: unknown;
}

export interface PluginSidebars {
  /** One header button per Plugin with a sidebar, in registry order. */
  buttons: { id: string; label: string; toggle(): void }[];
  /** The sidebar on screen, if any: its title, entries, the picked one and the bottom button. */
  shown: {
    title: string;
    entries: SidebarEntry[];
    current: number;
    hints: { key: string; description: string }[];
    run(key: string): void;
    menu?(id: string, x: number, y: number): void;
    button?: { label: string; onClick(): void };
  } | null;
  /** Shows the next Plugin's sidebar, or none after the last (`\`). */
  cycle(): void;
  /** Picks the previous or next entry of the sidebar on screen (`{`/`}`). */
  step(delta: -1 | 1): void;
  pick(id: string): void;
  /** What the board filters by. */
  filter: SidebarFilter;
}

/**
 * The Plugin Sidebars: which one is on screen, its entries and what is picked in each. `depth`
 * reloads the entries when a modal closes, e.g. after creating one, as does a change to the Data Root
 * on disk. A pick shows the board.
 */
export function usePluginSidebars(depth: number): PluginSidebars {
  const { services } = useContext(ServicesContext);
  const { plugins } = usePlugins();
  const changes = useDataRootChanges();
  const toast = useToast();
  const contextMenu = useContextMenu();
  const router = useRouter();
  const onPick = () => {
    if (router.stack[0]?.screen !== 'board') router.reset('board');
  };
  const withSidebar = useMemo(
    () =>
      plugins.flatMap(({ id, tui }) => (tui.sidebar ? [{ id, sidebar: tui.sidebar as PluginSidebar<unknown> }] : [])),
    [plugins],
  );
  const [openId, setOpenId] = useState<string | null>(null);
  const [picks, setPicks] = useState<Record<string, Pick>>({});
  const current = withSidebar.find((p) => p.id === openId);

  const items = useAsync(async () => {
    const at = withSidebar.find((p) => p.id === openId);
    if (!at || !services) return null;
    const loaded = await invokePlugin({ plugin: at.id, stage: 'field' }, () =>
      (async () => {
        const entries = await at.sidebar.items({ plugin: services.plugins.context(at.id) });
        return entries.map((item) => ({ ...item, links: at.sidebar.menu?.(item.value) ?? [] }));
      })(),
    );
    return { id: at.id, items: loaded };
  }, [withSidebar, openId, services, depth, changes]);
  const loaded = items.data && items.data.id === openId ? items.data.items : [];

  // An entry that is gone, such as a deleted one, is no longer picked.
  useEffect(() => {
    const id = items.data?.id;
    const picked = id === undefined ? undefined : picks[id];
    if (id === undefined || !picked || items.data?.items.some((item) => item.value === picked.value)) return;
    setPicks(({ [id]: _gone, ...rest }) => rest);
  }, [items.data, picks]);

  const entries: SidebarEntry[] = current
    ? [
        { id: ALL_ENTRY, label: current.sidebar.allLabel },
        ...loaded.map((item) => ({ id: item.value, label: item.label })),
      ]
    : [];
  const picked = openId === null ? undefined : picks[openId];
  const at = picked ? entries.findIndex((entry) => entry.id === picked.value) : 0;

  const pick = (id: string) => {
    if (!current) return;
    const { id: plugin, sidebar } = current;
    if (id === ALL_ENTRY) {
      setPicks(({ [plugin]: _cleared, ...rest }) => rest);
      return onPick();
    }
    const item = loaded.find((entry) => entry.value === id);
    if (!item) return;
    try {
      const filter = invokePluginSync({ plugin, stage: 'filter' }, () => sidebar.filter(item.value));
      setPicks((all) => ({ ...all, [plugin]: { value: item.value, label: item.label, filter } }));
      onPick();
    } catch (err) {
      toast.error(err);
    }
  };

  const filter = useMemo<SidebarFilter>(() => {
    const on = withSidebar.filter(({ id }) => picks[id] !== undefined);
    const input: PluginInput = Object.fromEntries(on.map(({ id }) => [id, picks[id]?.filter]));
    const summary = on.map(({ id, sidebar }) => `${sidebar.title}: ${picks[id]?.label}`).join(' · ');
    return { plugins: input, summary };
  }, [withSidebar, picks]);

  const latest = useRef({ openId, loaded });
  latest.current = { openId, loaded };
  const menu = (value: string, x: number, y: number) => {
    if (!current?.sidebar.menu || !loaded.some((item) => item.value === value)) return;
    const { id } = current;
    try {
      const links = loaded.find((item) => item.value === value)?.links ?? [];
      if (links.length === 0) return;
      contextMenu.open(
        x,
        y,
        links.map((link) => ({
          label: link.label,
          key: link.key,
          onSelect: () => {
            if (latest.current.openId === id && latest.current.loaded.some((item) => item.value === value)) {
              pluginUi(id, router, toast).open(link.screen, link.params);
            }
          },
        })),
      );
    } catch (err) {
      toast.error(err);
    }
  };
  const selectedLinks = loaded.find((item) => item.value === picked?.value)?.links ?? [];
  const create = current?.sidebar.create;
  return {
    buttons: withSidebar.map(({ id, sidebar }) => ({
      id,
      label: sidebar.title,
      toggle: () => setOpenId((was) => (was === id ? null : id)),
    })),
    shown: current
      ? {
          title: current.sidebar.title,
          entries,
          current: at,
          hints: selectedLinks.map((link) => ({ key: link.key, description: link.label.toLowerCase() })),
          run: (key) => {
            const link = selectedLinks.find((link) => link.key === key);
            if (link) pluginUi(current.id, router, toast).open(link.screen, link.params);
          },
          menu: current.sidebar.menu ? menu : undefined,
          button: create && {
            label: create.label,
            onClick: () => pluginUi(current.id, router, toast).open(create.screen, create.params),
          },
        }
      : null,
    cycle: () =>
      setOpenId((was) => {
        const next = withSidebar.findIndex((p) => p.id === was) + 1;
        return withSidebar[next]?.id ?? null;
      }),
    step: (delta) => {
      if (entries.length === 0) return;
      const next = entries[(Math.max(at, 0) + delta + entries.length) % entries.length];
      if (next) pick(next.id);
    },
    pick,
    filter,
  };
}
