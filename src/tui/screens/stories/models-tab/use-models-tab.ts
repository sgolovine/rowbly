import { useInput } from "ink";
import { useEffect, useState } from "react";
import type { AuthRuntime } from "../../../../services/agent-auth/agent-auth.js";
import { type FactorySettings, getFactorySettings } from "../../../../services/factory-settings/factory-settings.js";
import { type CachedPiCatalog, readPiCatalog } from "../../../../services/pi-catalog-cache/pi-catalog-cache.js";
import { refreshPiCatalog } from "../../../../services/pi-catalog-cache/pi-catalog-refresh.js";
import { listStages, type Stage } from "../../../../services/stage/stage.js";
import type { ServiceContext } from "../../../../services/workspace/workspace.js";
import { useCovered } from "../../../components/index.js";
import {
  type AsyncState,
  type Layout,
  useAsync,
  useIsActive,
  useLatest,
  useLayout,
  useReportHints,
  useToast,
} from "../../../hooks/index.js";
import type { KeyHint } from "../../../keymap.js";
import type { PickerModel } from "../../settings/model-picker-modal/index.js";
import { handleKey, type ModelsTabEnv } from "./models-tab-actions.js";
import { modelsTabHints } from "./models-tab-view.js";

export interface ModelsTabProps {
  readonly ctx: ServiceContext;
  readonly storyId: string;
  /** This tab is the tab on the screen, and takes the keys. */
  readonly selected: boolean;
  onHints(hints: readonly KeyHint[]): void;
  /** The model picker is open, so that the Modal leaves `esc` and the save key to it. */
  onTask(value: boolean): void;
  /** Loads the Pi model runtime; tests replace it. */
  readonly loadRuntime: () => Promise<AuthRuntime>;
}

/** The state of the Models tab that its render reads. */
export interface ModelsTabState {
  readonly env: ModelsTabEnv;
  readonly layout: Layout;
  readonly settings: AsyncState<FactorySettings>;
  /** The refreshed models, else the cached models, else `undefined` while nothing has loaded. */
  readonly models: readonly PickerModel[] | undefined;
  /** True while no models show and the cache or Pi loads. */
  readonly loading: boolean;
  /** The Stage of the open model picker. */
  readonly task: Stage | null;
  /** The tab has the keys, and no picker is open. */
  readonly idle: boolean;
}

/** The result of a read of the model cache. `catalog` is `undefined` when the cache is missing. */
interface CacheRead {
  readonly catalog: CachedPiCatalog | undefined;
}

/** Reads the model cache only after the tab is shown one time. Before that, there is nothing to read. */
async function readAfterShown(shown: boolean, ctx: ServiceContext): Promise<CacheRead | undefined> {
  return shown ? { catalog: await readPiCatalog(ctx) } : undefined;
}

/**
 * Loads Pi and refreshes the cache when the cache is stale or missing. A fresh cache does not load Pi. A failure
 * with cached models keeps them on the screen without a toast; without cached models the failure shows.
 */
async function refreshWhenStale(
  read: CacheRead | undefined,
  loadRuntime: () => Promise<AuthRuntime>,
  ctx: ServiceContext,
): Promise<readonly PickerModel[] | undefined> {
  if (!read || read.catalog?.fresh) {
    return undefined;
  }

  try {
    return (await refreshPiCatalog(await loadRuntime(), ctx)).models;
  } catch (error) {
    if (read.catalog) {
      return undefined;
    }

    throw error;
  }
}

/**
 * The Stages, the overrides, the models and the keys of the Models tab. The model cache is read when the tab is
 * shown the first time, so that a Story that a person only reads does not read it. Its models show at once. Pi
 * loads in the background only when the cache is stale or missing, and its models then replace the cached ones.
 */
export function useModelsTab({ ctx, storyId, selected, onHints, onTask, loadRuntime }: ModelsTabProps): ModelsTabState {
  const active = useIsActive();
  const covered = useCovered();
  const toast = useToast();
  const layout = useLayout();
  const [shown, setShown] = useState(false);
  const [task, setTask] = useState<Stage | null>(null);
  const [cursor, setCursor] = useState(0);
  // The latest `loadRuntime`, so that a new function on each render does not load Pi again on each render.
  const load = useLatest(loadRuntime);
  const cache = useAsync(() => readAfterShown(shown, ctx), [shown, ctx]);
  const refresh = useAsync(() => refreshWhenStale(cache.data, load.current, ctx), [cache.data]);
  const settings = useAsync(() => getFactorySettings(ctx), [ctx, selected]);
  const stages = useAsync<readonly Stage[]>(() => listStages(ctx), [ctx, selected]);

  const list = stages.data ?? [];
  const models = refresh.data ?? cache.data?.catalog?.models;
  const ready = models !== undefined;
  const idle = active && selected && !covered && task === null;
  const loading = shown && !ready && (cache.loading || refresh.loading);
  const env: ModelsTabEnv = {
    ctx,
    storyId,
    toast,
    stages: list,
    cursor: Math.min(cursor, Math.max(0, list.length - 1)),
    ready,
    setCursor,
    setTask,
    reload: settings.reload,
  };

  useEffect(() => {
    if (selected) {
      setShown(true);
    }
  }, [selected]);
  useEffect(() => {
    onTask(task !== null);

    return () => onTask(false);
  }, [task, onTask]);
  useReportHints(onHints, modelsTabHints({ stages: list.length > 0, ready }));
  useInput((input, key) => handleKey(env, input, key), { isActive: idle });

  return { env, layout, settings, models, loading, task, idle };
}
