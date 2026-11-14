import { useInput } from "ink";
import { type Dispatch, type SetStateAction, useEffect, useRef, useState } from "react";
import type { FactoryLaunch, FactoryStatus } from "../../../../services/factory/factory.js";
import { getFactorySettings } from "../../../../services/factory-settings/factory-settings.js";
import type { Story } from "../../../../services/story/story.js";
import { listThreads, type ThreadRecord, watchThreads } from "../../../../services/thread/thread.js";
import type { ServiceContext } from "../../../../services/workspace/workspace.js";
import {
  type Layout,
  stopOnAbort,
  useAsync,
  useEscape,
  useIsActive,
  useKeyCapture,
  useLayout,
  useToast,
} from "../../../hooks/index.js";
import { factoryLive } from "../factory-status.js";
import { type FactoryKeyEnv, type FactoryRunKind, handleFactoryKey, runFactory } from "./factory-run.js";
import { type FactoryAttention, useFactoryAttention } from "./use-factory-attention.js";

/**
 * The part of the Factory controls on screen: the overview, the supervisor conversation, the history, the list
 * of the warnings or the detail view of one warning.
 */
type FactoryView = "main" | "supervisor" | "history" | "attention" | "problem";

/** The inputs of the Factory controls. */
export interface FactoryModalInput {
  readonly ctx: ServiceContext;
  readonly status: FactoryStatus | undefined;
  readonly launch: FactoryLaunch | undefined;
  readonly onClose: () => void;
  readonly onAiSettings: (() => void) | undefined;
  readonly checkProvider: () => Promise<boolean>;
  /** The Stories of the board, to find the Story of a warning. */
  readonly stories: readonly Story[];
  readonly onOpenStory: ((story: Story) => void) | undefined;
  readonly onOpenThread: ((thread: ThreadRecord) => void) | undefined;
}

/** What the Factory controls can do now. */
interface FactoryAbilities {
  readonly start: boolean;
  readonly stop: boolean;
  readonly inspect: boolean;
  /** The live factory has warnings, so `w` can open their list. */
  readonly warnings: boolean;
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
  /** True when no dialog, conversation, history or warning view has the keys. */
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
  readonly attention: FactoryAttention;
}

/** The view that has the screen. The supervisor conversation comes first, then the views of the warnings. */
function factoryView(inspecting: boolean, history: boolean, attention: FactoryAttention): FactoryView {
  if (inspecting) {
    return "supervisor";
  }

  if (attention.problem) {
    return "problem";
  }

  if (attention.listOpen) {
    return "attention";
  }

  return history ? "history" : "main";
}

interface AbilityInput {
  readonly busy: FactoryRunKind | null;
  readonly launch: FactoryLaunch | undefined;
  readonly supervisorId: string | undefined;
  readonly warnings: number;
}

function abilities(status: FactoryStatus | undefined, input: AbilityInput): FactoryAbilities {
  const live = factoryLive(status);

  return {
    start: !live && input.busy === null && input.launch !== undefined,
    stop: live && status?.phase !== "stopping" && input.busy === null,
    inspect: input.supervisorId !== undefined,
    warnings: input.warnings > 0,
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

/**
 * All Threads of the Project, the oldest first: the supervisors for the history, and the Threads of the
 * warnings. They are read again when the phase or the supervisor changes, and on each Thread change.
 */
function useProjectThreads(ctx: ServiceContext, status: FactoryStatus | undefined): readonly ThreadRecord[] {
  const threads = useAsync(() => listThreads({}, ctx), [ctx, status?.phase, status?.supervisorThreadId]);
  const refresh = threads.refresh;

  useEffect(() => {
    const live = new AbortController();

    void watchThreads(refresh, ctx)
      .then((stop) => stopOnAbort(live.signal, stop))
      .catch(() => {});

    return () => live.abort();
  }, [ctx, refresh]);

  return threads.data?.threads ?? [];
}

/** The supervisor Threads, and the supervisor that the person selected, or the current or the last one. */
function supervisorOf(all: readonly ThreadRecord[], selectedId: string | undefined, status: FactoryStatus | undefined) {
  const threads = all.filter((thread) => thread.role === "supervisor");
  const supervisorId = selectedId ?? status?.supervisorThreadId ?? threads.at(-1)?.id;

  return { threads, supervisorId, supervisor: threads.find((thread) => thread.id === supervisorId) };
}

/** The abilities in the form that the keys read. */
function keyAbilities(can: FactoryAbilities) {
  return { canStart: can.start, canStop: can.stop, canInspect: can.inspect, canWarnings: can.warnings };
}

/**
 * The state, the keys and the handlers of the Factory controls. `esc` closes the conversation first, then
 * the history or the views of the warnings, then the Modal.
 */
export function useFactoryModal(input: FactoryModalInput): FactoryModalModel {
  const { ctx, status, launch, onClose } = input;
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
  const allThreads = useProjectThreads(ctx, status);
  const settings = useAsync(() => getFactorySettings(ctx), [ctx]);
  const [provider, setProvider] = useState<boolean>();

  const live = factoryLive(status);
  const { threads, supervisorId, supervisor } = supervisorOf(allThreads, selectedId, status);
  const inspecting = inspect && supervisorId !== undefined;
  const attention = useFactoryAttention({
    ...input,
    threads: allThreads,
    active: active && !confirm && !inspecting && !history,
  });
  const can = abilities(status, { busy, launch, supervisorId, warnings: attention.problems.length });
  const view = factoryView(inspecting, history, attention);
  const idle = active && !confirm && view === "main";

  const env: FactoryKeyEnv = {
    ...input,
    ...keyAbilities(can),
    toast,
    working,
    setBusy,
    setProvider,
    openWarnings: attention.actions.openList,
    setConfirm,
    setInspect,
    setHistory,
  };

  useKeyCapture(active, { text: false, escape: true });
  useEscape(idle, onClose);
  useEscape(active && view === "supervisor", () => setInspect(false));
  useEscape(active && view === "history" && !filtering, () => setHistory(false));
  useInput((text, key) => handleFactoryKey(env, text, key), { isActive: idle });

  return {
    active,
    idle,
    view,
    live,
    busy,
    confirm,
    provider,
    can,
    threads,
    supervisorId,
    supervisor,
    limit: status?.workers?.limit ?? settings.data?.maxWorkers,
    layout,
    actions: factoryActions(env, setSelectedId, setFiltering),
    attention,
  };
}
