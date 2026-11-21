import { useInput } from "ink";
import { type Dispatch, type SetStateAction, useEffect, useRef, useState } from "react";
import type { FactoryLaunch, FactoryStatus } from "../../../../services/factory/factory.js";
import { getFactorySettings, hasWorkerModel } from "../../../../services/factory-settings/factory-settings.js";
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
 * The part of the Factory controls on screen: the overview, the list of the old supervisor Threads, the read-only
 * conversation of one old Thread, the list of the warnings or the detail view of one warning.
 */
type FactoryView = "main" | "thread" | "history" | "attention" | "problem";

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
  /** The live factory has warnings, so `w` can open their list. */
  readonly warnings: boolean;
  /** The `Attention` list has more rows than its window, so `↑/↓` scroll it. */
  readonly scroll: boolean;
  /** A warning can be dismissed and no dismiss runs, so `d` asks to dismiss all. */
  readonly dismissAll: boolean;
}

/** The handlers of the buttons, the history and the stop confirmation. */
interface FactoryModalActions {
  readonly start: () => void;
  readonly askStop: () => void;
  readonly confirmStop: () => void;
  readonly cancelStop: () => void;
  readonly closeThread: () => void;
  readonly openHistory: () => void;
  readonly closeHistory: () => void;
  readonly pickThread: (id: string) => void;
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
  /** False when the settings have no worker model. Undefined while the settings load. */
  readonly workerModel: boolean | undefined;
  readonly can: FactoryAbilities;
  /** The old supervisor Threads, the oldest first. */
  readonly threads: readonly ThreadRecord[];
  /** The old Thread that the person selected in the history. */
  readonly selectedId: string | undefined;
  readonly selected: ThreadRecord | undefined;
  /** The worker limit of the live factory, or of the settings when the factory is off. */
  readonly limit: number | undefined;
  readonly layout: Layout;
  readonly actions: FactoryModalActions;
  readonly attention: FactoryAttention;
}

/** The view that has the screen. The conversation of an old Thread comes first, then the views of the warnings. */
function factoryView(inspecting: boolean, history: boolean, attention: FactoryAttention): FactoryView {
  if (inspecting) {
    return "thread";
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
  readonly attention: FactoryAttention;
}

function abilities(status: FactoryStatus | undefined, input: AbilityInput): FactoryAbilities {
  const live = factoryLive(status);

  return {
    start: !live && input.busy === null && input.launch !== undefined,
    stop: live && status?.phase !== "stopping" && input.busy === null,
    warnings: input.attention.problems.length > 0,
    scroll: input.attention.can.scroll,
    dismissAll: input.attention.can.dismissAll,
  };
}

/** Closes the confirmation, then stops the factory. */
function confirmStop(env: FactoryKeyEnv): void {
  env.setConfirm(false);
  void runFactory(env, "stop");
}

/** Shows the read-only conversation of an old Thread from the history. */
function pickThread(
  setSelectedId: Dispatch<SetStateAction<string | undefined>>,
  setInspect: Dispatch<SetStateAction<boolean>>,
  id: string,
): void {
  setSelectedId(id);
  setInspect(true);
}

interface ViewSetters {
  readonly setSelectedId: Dispatch<SetStateAction<string | undefined>>;
  readonly setInspect: Dispatch<SetStateAction<boolean>>;
  readonly setFiltering: Dispatch<SetStateAction<boolean>>;
}

function factoryActions(env: FactoryKeyEnv, setters: ViewSetters): FactoryModalActions {
  return {
    start: () => void runFactory(env, "start"),
    askStop: () => env.setConfirm(true),
    confirmStop: () => confirmStop(env),
    cancelStop: () => env.setConfirm(false),
    closeThread: () => setters.setInspect(false),
    openHistory: () => env.setHistory(true),
    closeHistory: () => env.setHistory(false),
    pickThread: (id) => pickThread(setters.setSelectedId, setters.setInspect, id),
    setFiltering: setters.setFiltering,
  };
}

/**
 * All Threads of the Project, the oldest first: the old supervisor Threads for the history, and the Threads of the
 * warnings. They are read again when the phase changes, and on each Thread change.
 */
function useProjectThreads(ctx: ServiceContext, status: FactoryStatus | undefined): readonly ThreadRecord[] {
  const threads = useAsync(() => listThreads({}, ctx), [ctx, status?.phase]);
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

/** The old supervisor Threads, and the Thread that the person selected in the history. */
function oldThreadsOf(all: readonly ThreadRecord[], selectedId: string | undefined) {
  const threads = all.filter((thread) => thread.role === "supervisor");

  return { threads, selected: threads.find((thread) => thread.id === selectedId) };
}

/** The abilities in the form that the keys read. */
function keyAbilities(can: FactoryAbilities) {
  return {
    canStart: can.start,
    canStop: can.stop,
    canWarnings: can.warnings,
    canScroll: can.scroll,
    canDismissAll: can.dismissAll,
  };
}

/** The actions of the Attention views that the keys of the main view call. */
function attentionKeyActions(attention: FactoryAttention) {
  const { openList, scroll, askDismissAll } = attention.actions;

  return { openWarnings: openList, scroll, askDismissAll };
}

/**
 * The state, the keys and the handlers of the Factory controls. `esc` closes the conversation of an old Thread
 * first, then the history or the views of the warnings, then the Modal.
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
  const { threads, selected } = oldThreadsOf(allThreads, selectedId);
  const inspecting = inspect && selected !== undefined;
  const attention = useFactoryAttention({
    ...input,
    threads: allThreads,
    active: active && !confirm && !inspecting && !history,
  });
  const can = abilities(status, { busy, launch, attention });
  const view = factoryView(inspecting, history, attention);
  const idle = active && !confirm && !attention.confirmAll && view === "main";

  const env: FactoryKeyEnv = {
    ...input,
    ...keyAbilities(can),
    toast,
    working,
    setBusy,
    setProvider,
    ...attentionKeyActions(attention),
    setConfirm,
    setHistory,
  };

  useKeyCapture(active, { text: false, escape: true });
  useEscape(idle, onClose);
  useEscape(active && view === "thread", () => setInspect(false));
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
    workerModel: settings.data && hasWorkerModel(settings.data),
    can,
    threads,
    selectedId: selected?.id,
    selected,
    limit: status?.workers?.limit ?? settings.data?.maxWorkers,
    layout,
    actions: factoryActions(env, { setSelectedId, setInspect, setFiltering }),
    attention,
  };
}
