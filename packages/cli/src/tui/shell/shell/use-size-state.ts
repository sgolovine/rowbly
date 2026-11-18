import { type Dispatch, type RefObject, type SetStateAction, useEffect, useRef, useState } from "react";
import { type LayoutPrefs, readLayoutPrefs, writeLayoutPrefs } from "../../../services/layout-prefs/layout-prefs.js";
import type { ServiceContext } from "../../../services/workspace/workspace.js";
import { SIDEBAR_WIDTH } from "../../components/index.js";
import { type ToastStore, useLatest, useToast } from "../../hooks/index.js";
import { writeRef } from "../../hooks/refs.js";

/** The time after the last step of a drag before Rowbly saves the sizes. A drag gives many steps, and one write. */
const SAVE_DELAY_MS = 400;

/** The sizes that the user dragged in this run. `null` is no drag. */
interface DraggedSizes {
  readonly sidebarWidth: number | null;
  readonly tagsHeight: number | null;
  readonly storyWidth: number | null;
}

/** What a save of the sizes needs. `saved` holds the sizes in the file, as Rowbly knows them. */
interface SaveEnv {
  readonly ctx: ServiceContext;
  readonly toast: ToastStore;
  readonly saved: RefObject<LayoutPrefs>;
  readonly dragged: DraggedSizes;
}

/** The dragged sizes that are not in the file. */
function changedSizes(dragged: DraggedSizes, saved: LayoutPrefs): LayoutPrefs {
  return Object.fromEntries(
    Object.entries(dragged).filter(([key, value]) => value !== null && saved[key as keyof LayoutPrefs] !== value),
  ) as LayoutPrefs;
}

/** Writes the dragged sizes that changed. It writes nothing when no size changed. A failure shows an error toast. */
function saveSizes(env: SaveEnv): void {
  const changed = changedSizes(env.dragged, env.saved.current);

  if (Object.keys(changed).length === 0) {
    return;
  }

  writeRef(env.saved, { ...env.saved.current, ...changed });
  writeLayoutPrefs(changed, env.ctx).catch((err: unknown) => env.toast.error(err));
}

/**
 * Reads the saved sizes one time. A failed read keeps the defaults. A size that the user dragged before the read
 * ends stays, because the dragged sizes come before the saved sizes.
 */
async function loadSizes(
  ctx: ServiceContext,
  saved: RefObject<LayoutPrefs>,
  setLoaded: Dispatch<SetStateAction<LayoutPrefs>>,
  signal: AbortSignal,
): Promise<void> {
  const prefs = await readLayoutPrefs(ctx).catch(() => ({}));

  if (signal.aborted) {
    return;
  }

  writeRef(saved, { ...prefs, ...saved.current });
  setLoaded(prefs);
}

/**
 * The sizes after a drag with the mouse: the width of the sidebars, the rows of the tag sidebar and the width of the
 * Story sidebar. `null` is the default size. The sizes start from the sizes in `~/.rowblyrc.json`, and Rowbly saves
 * a dragged size there a short time after the drag stops.
 */
export function useSizeState(ctx: ServiceContext) {
  const toast = useToast();
  const [loaded, setLoaded] = useState<LayoutPrefs>({});
  const [sidebarWidth, setSidebarWidth] = useState<number | null>(null);
  const [tagsHeight, setTagsHeight] = useState<number | null>(null);
  const [storyWidth, setStoryWidth] = useState<number | null>(null);
  const saved = useRef<LayoutPrefs>({});
  const latest = useLatest<SaveEnv>({ ctx, toast, saved, dragged: { sidebarWidth, tagsHeight, storyWidth } });

  // biome-ignore lint/correctness/useExhaustiveDependencies: the sizes are for all Projects, so read them one time.
  useEffect(() => {
    const controller = new AbortController();

    void loadSizes(ctx, saved, setLoaded, controller.signal);

    return () => controller.abort();
  }, []);

  // Each step of a drag starts the delay again, so Rowbly writes one time after the drag stops.
  // biome-ignore lint/correctness/useExhaustiveDependencies: a change of a dragged size starts the delay again.
  useEffect(() => {
    const timer = setTimeout(() => saveSizes(latest.current), SAVE_DELAY_MS);

    return () => clearTimeout(timer);
  }, [latest, sidebarWidth, tagsHeight, storyWidth]);

  // A quit before the delay ends still saves the last drag.
  useEffect(() => () => saveSizes(latest.current), [latest]);

  return {
    values: {
      sidebarWidth: sidebarWidth ?? loaded.sidebarWidth ?? SIDEBAR_WIDTH,
      tagsHeight: tagsHeight ?? loaded.tagsHeight ?? null,
      storyWidth: storyWidth ?? loaded.storyWidth ?? null,
    },
    setters: { setSidebarWidth, setTagsHeight, setStoryWidth },
  };
}
