import { useInput } from "ink";
import { type Dispatch, type SetStateAction, useEffect, useRef, useState } from "react";
import type { FactoryLaunch, FactoryStatus } from "../../../../services/factory/factory.js";
import { getFactorySettings } from "../../../../services/factory-settings/factory-settings.js";
import { listThreads, type ThreadRecord, watchThreads } from "../../../../services/thread/thread.js";
import type { ServiceContext } from "../../../../services/workspace/workspace.js";
import {
  type Layout,
  useAsync,
  useEscape,
  useIsActive,
  useKeyCapture,
  useLayout,
  useToast,
} from "../../../hooks/index.js";
import { factoryLive } from "../factory-status.js";
import { type FactoryKeyEnv, type FactoryRunKind, handleFactoryKey, runFactory } from "./factory-run.js";

/** The part of the Factory controls on screen: the overview, the supervisor conversation or the history. */
type FactoryView = "main" | "supervisor" | "history";

/** The inputs of the Factory controls. */
export interface FactoryModalInput {
  readonly ctx: ServiceContext;
  readonly status: FactoryStatus | undefined;
  readonly launch: FactoryLaunch | undefined;
  readonly onClose: () => void;
  readonly onAiSettings: (() => void) | undefined;
  readonly checkProvider: () => Promise<boolean>;
}

/** What the Factory controls can do now. */
interface FactoryAbilities {
  readonly start: boolean;
  readonly stop: boolean;
  readonly inspect: boolean;
}

/** The handlers of the buttons, the history and the stop confirmation. */
interface FactoryModalActions {
  readonly start: () => void;
  readonly askStop: () => void;
  readonly confirmStop: () => void;
  readonly cancelStop: () => void;
  readonly openSupervisor: () => void;
  readonly closeSupervisor: () => void;
  readonly openHistory: () => void;
  readonly closeHistory: () => void;
  readonly pickSupervisor: (id: string) => void;
  readonly setFiltering: Dispatch<SetStateAction<boolean>>;
}

/** The state of the Factory controls for one render. */
export interface FactoryModalModel {
  readonly active: boolean;
  /** True when no dialog, conversation or history has the keys. */
  readonly idle: boolean;
  readonly view: FactoryView;
  readonly live: boolean;
  readonly busy: FactoryRunKind | null;
  readonly confirm: boolean;
  /** False after a start found no AI provider with credentials. */
  readonly provider: boolean | undefined;
  readonly can: FactoryAbilities;
  readonly threads: readonly ThreadRecord[];
  readonly supervisorId: string | undefined;
  readonly supervisor: ThreadRecord | undefined;
  /** The worker limit of the live factory, or of the settings when the factory is off. */
  readonly limit: number | undefined;
  readonly layout: Layout;
  readonly actions: FactoryModalActions;
}

/** The view that has the screen. The supervisor conversation comes before the history. */
function factoryView(inspecting: boolean, history: boolean): FactoryView {
  if (inspecting) {
    return "supervisor";
  }

  return history ? "history" : "main";
}

interface AbilityInput {
  readonly busy: FactoryRunKind | null;
  readonly launch: FactoryLaunch | undefined;
  readonly supervisorId: string | undefined;
}

function abilities(status: FactoryStatus | undefined, input: AbilityInput): FactoryAbilities {
  const live = factoryLive(status);

  return {
    start: !live && input.busy === null && input.launch !== undefined,
    stop: live && status?.phase !== "stopping" && input.busy === null,
    inspect: input.supervisorId !== undefined,
  };
}

/** Closes the confirmation, then stops the factory. */
function confirmStop(env: FactoryKeyEnv): void {
  env.setConfirm(false);
  void runFactory(env, "stop");
}

/** Shows the conversation of a supervisor from the history. */
function pickSupervisor(
  env: FactoryKeyEnv,
  setSelectedId: Dispatch<SetStateAction<string | undefined>>,
  id: string,
): void {
  setSelectedId(id);
  env.setInspect(true);
}

function factoryActions(
  env: FactoryKeyEnv,
  setSelectedId: Dispatch<SetStateAction<string | undefined>>,
  setFiltering: Dispatch<SetStateAction<boolean>>,
): FactoryModalActions {
  return {
    start: () => void runFactory(env, "start"),
    askStop: () => env.setConfirm(true),
    confirmStop: () => confirmStop(env),
    cancelStop: () => env.setConfirm(false),
    openSupervisor: () => env.setInspect(true),
    closeSupervisor: () => env.setInspect(false),
    openHistory: () => env.setHistory(true),
    closeHistory: () => env.setHistory(false),
    pickSupervisor: (id) => pickSupervisor(env, setSelectedId, id),
    setFiltering,
  };
}

/** Stops a watch when the effect ends, also when the watch starts after the end. */
function stopWhenAborted(signal: AbortSignal, stop: () => void): void {
  if (signal.aborted) {
    stop();

    return;
  }

  signal.addEventListener("abort", stop, { once: true });
}

/** The supervisor Threads, read again when the phase or the supervisor changes, and on each Thread change. */
function useSupervisorThreads(ctx: ServiceContext, status: FactoryStatus | undefined): readonly ThreadRecord[] {
  const supervisors = useAsync(
    () => listThreads({ role: "supervisor" }, ctx),
    [ctx, status?.phase, status?.supervisorThreadId],
  );
  const refresh = supervisors.refresh;

  useEffect(() => {
    const live = new AbortController();

    void watchThreads(refresh, ctx)
      .then((stop) => stopWhenAborted(live.signal, stop))
      .catch(() => {});

    return () => live.abort();
  }, [ctx, refresh]);

  return supervisors.data?.threads ?? [];
}

/**
 * The state, the keys and the handlers of the Factory controls. `esc` closes the conversation first, then
 * the history, then the Modal.
 */
export function useFactoryModal(input: FactoryModalInput): FactoryModalModel {
  const { ctx, status, launch, onClose, onAiSettings, checkProvider } = input;
  const active = useIsActive();
  const toast = useToast();
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState<FactoryRunKind | null>(null);
  const [inspect, setInspect] = useState(false);
  const layout = useLayout();
  const working = useRef(false);
  const [selectedId, setSelectedId] = useState<string>();
  const [history, setHistory] = useState(false);
  const [filtering, setFiltering] = useState(false);
  const threads = useSupervisorThreads(ctx, status);
  const settings = useAsync(() => getFactorySettings(ctx), [ctx]);
  const [provider, setProvider] = useState<boolean>();

  const live = factoryLive(status);
  const supervisorId = selectedId ?? status?.supervisorThreadId ?? threads.at(-1)?.id;
  const supervisor = threads.find((thread) => thread.id === supervisorId);
  const can = abilities(status, { busy, launch, supervisorId });
  const inspecting = inspect && can.inspect;
  const idle = active && !confirm && !inspecting && !history;
  const limit = status?.workers?.limit ?? settings.data?.maxWorkers;

  const env: FactoryKeyEnv = {
    ctx,
    launch,
    toast,
    working,
    checkProvider,
    setBusy,
    setProvider,
    canStart: can.start,
    canStop: can.stop,
    canInspect: can.inspect,
    setConfirm,
    setInspect,
    setHistory,
    onAiSettings,
  };

  useKeyCapture(active, { text: false, escape: true });
  useEscape(idle, onClose);
  useEscape(active && inspecting, () => setInspect(false));
  useEscape(active && history && !inspecting && !filtering, () => setHistory(false));
  useInput((text, key) => handleFactoryKey(env, text, key), { isActive: idle });

  return {
    active,
    idle,
    view: factoryView(inspecting, history),
    live,
    busy,
    confirm,
    provider,
    can,
    threads,
    supervisorId,
    supervisor,
    limit,
    layout,
    actions: factoryActions(env, setSelectedId, setFiltering),
  };
}
