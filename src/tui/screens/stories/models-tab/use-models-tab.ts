import { useInput } from "ink";
import { useEffect, useState } from "react";
import { type AuthRuntime, listAvailableModels } from "../../../../services/agent-auth/agent-auth.js";
import { type FactorySettings, getFactorySettings } from "../../../../services/factory-settings/factory-settings.js";
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
  readonly models: AsyncState<readonly PickerModel[] | undefined>;
  /** True while Pi or the models load. */
  readonly loading: boolean;
  /** The Stage of the open model picker. */
  readonly task: Stage | null;
  /** The tab has the keys, and no picker is open. */
  readonly idle: boolean;
}

/** Loads Pi only after the tab is shown one time. Before that, there is no runtime. */
function loadAfterShown(shown: boolean, loadRuntime: () => Promise<AuthRuntime>): Promise<AuthRuntime | undefined> {
  return shown ? loadRuntime() : Promise.resolve(undefined);
}

function loadModels(runtime: AuthRuntime | undefined): Promise<readonly PickerModel[] | undefined> {
  return runtime ? listAvailableModels(runtime) : Promise.resolve(undefined);
}

/**
 * The Stages, the overrides, the models and the keys of the Models tab. Pi loads when the tab is shown the first
 * time, so that a Story that a person only reads does not load Pi.
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
  const runtime = useAsync(() => loadAfterShown(shown, load.current), [shown]);
  const models = useAsync(() => loadModels(runtime.data), [runtime.data]);
  const settings = useAsync(() => getFactorySettings(ctx), [ctx, selected]);
  const stages = useAsync<readonly Stage[]>(() => listStages(ctx), [ctx, selected]);

  const list = stages.data ?? [];
  const ready = models.data !== undefined;
  const idle = active && selected && !covered && task === null;
  const loading = shown && (runtime.loading || (runtime.data !== undefined && models.loading));
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
