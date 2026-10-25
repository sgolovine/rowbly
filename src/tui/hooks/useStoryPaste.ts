import { useInput, usePaste } from 'ink';
import { useEffect, useMemo, useRef, useState } from 'react';
import type { Story } from '../../schemas';
import { invokePlugin, invokePluginSync, type PluginInput } from '../../services';
import { clipboard } from '../../services/clipboard';
import { useCovered } from '../components';
import { useRouter } from '../router';
import { pluginUi, usePlugins } from './plugins';
import { useDirty, useIsActive } from './shell';
import { type ToastStore, useToast } from './toasts';
import { useServices } from './useServices';

// A read remains in flight even if its screen closes and another Story opens.
const reading = new WeakSet<ToastStore>();

/** Image gestures belong to the whole Story, independently of its selected tab or field. */
export function useStoryPaste({
  boardId,
  story,
  form = false,
  enabled = true,
  onSaved,
}: {
  boardId?: string;
  story?: Story | null;
  form?: boolean;
  enabled?: boolean;
  onSaved?(): void;
}) {
  const services = useServices();
  const router = useRouter();
  const toast = useToast();
  const { plugins } = usePlugins();
  const claimant = plugins.find((p) => p.tui.storyPaste);
  const active = useIsActive();
  const covered = useCovered();
  const allowed = active && !covered && enabled && !!boardId;
  const [busy, setBusy] = useState(false);
  const pending = useRef<unknown>(undefined);
  const pendingOwner = useRef<string | undefined>(undefined);
  const [dirty, setDirty] = useState(false);
  const generation = useRef(0);
  const progress = useRef<number | undefined>(undefined);
  const latest = useRef({ allowed, router, claimant, services });
  latest.current = { allowed, router, claimant, services };
  const route = router.current;
  const storyKey = story?.key;
  // biome-ignore lint/correctness/useExhaustiveDependencies: changing the input owner invalidates an outstanding read.
  useEffect(() => {
    generation.current++;
    return () => {
      generation.current++;
      if (progress.current !== undefined) toast.dismiss(progress.current);
    };
  }, [allowed, route, claimant, services, storyKey, toast]);
  useDirty(form && dirty);
  const accepting = allowed && !busy;
  const hints = useMemo(
    () =>
      accepting && claimant
        ? [{ key: process.platform === 'win32' ? 'alt+v' : 'ctrl+v', description: 'paste image' }]
        : [],
    [accepting, claimant],
  );

  const paste = async () => {
    if (!allowed || reading.has(toast)) return;
    if (!claimant?.tui.storyPaste) {
      toast.push('info', 'Turn on a Plugin that takes pasted images');
      return;
    }
    const handler = claimant.tui.storyPaste;
    const session = generation.current;
    const current = () =>
      session === generation.current &&
      latest.current.allowed &&
      latest.current.router.current === route &&
      latest.current.claimant === claimant &&
      latest.current.services === services;
    reading.add(toast);
    setBusy(true);
    const id = toast.pending('Reading clipboard image…');
    progress.current = id;
    try {
      const image = await clipboard.readImage();
      if (!current()) return;
      if ('reason' in image) {
        const messages = {
          'no-image': 'No image on the clipboard',
          'too-large': 'Clipboard image is too large (maximum 10 MiB)',
          timeout: 'Reading the clipboard image timed out',
          unsupported: 'Cannot read a clipboard image in this environment',
          'no-display': 'Cannot read a clipboard image in this environment',
        };
        const wayland =
          (image.reason === 'unsupported' || image.reason === 'no-display') && process.env.WAYLAND_DISPLAY;
        toast.push('warning', messages[image.reason] + (wayland ? '; install wl-clipboard and try again' : ''));
        return;
      }
      toast.update(id, `Pasting image with Plugin "${claimant.id}"…`);
      const plugin = services.plugins.context(claimant.id);
      const ui = pluginUi(claimant.id, router, toast);
      if (form) {
        const previous = pendingOwner.current === claimant.id ? pending.current : undefined;
        let next = previous;
        invokePluginSync({ plugin: claimant.id, stage: 'field' }, () =>
          handler.form({
            boardId: boardId as string,
            story: story ?? null,
            image,
            pending: previous,
            setPending: (value) => {
              next = value;
            },
            plugin,
            ui,
          }),
        );
        if (current()) {
          pending.current = next;
          pendingOwner.current = claimant.id;
          setDirty(next !== undefined);
        }
      } else if (story) {
        await invokePlugin({ plugin: claimant.id, stage: 'screen' }, () => handler.story({ story, image, plugin, ui }));
        if (current()) onSaved?.();
      }
    } catch (err) {
      if (current()) toast.error(err);
    } finally {
      toast.dismiss(id);
      if (progress.current === id) progress.current = undefined;
      reading.delete(toast);
      setBusy(false);
    }
  };
  useInput(
    (input, key) => {
      if (input === 'v' && (key.ctrl || key.meta)) void paste();
    },
    { isActive: accepting },
  );
  usePaste(
    (text) => {
      if (text === '') void paste();
    },
    { isActive: accepting },
  );

  return {
    busy,
    hints,
    saved() {
      pending.current = undefined;
      pendingOwner.current = undefined;
      setDirty(false);
    },
    input(base?: PluginInput): PluginInput | undefined {
      if (pending.current === undefined || !claimant?.tui.storyPaste || pendingOwner.current !== claimant.id)
        return base;
      const value = invokePluginSync(
        { plugin: claimant.id, stage: 'field', operation: story ? 'stories.update' : 'stories.create' },
        () => claimant.tui.storyPaste?.input({ pending: pending.current, story: story ?? null }),
      );
      if (value === undefined) return base;
      const before = base?.[claimant.id];
      const merged =
        before &&
        typeof before === 'object' &&
        !Array.isArray(before) &&
        value &&
        typeof value === 'object' &&
        !Array.isArray(value)
          ? { ...before, ...value }
          : value;
      return { ...base, [claimant.id]: merged };
    },
  };
}
