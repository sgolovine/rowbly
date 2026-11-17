import { useInput } from "ink";
import { useEffect, useRef, useState } from "react";
import { type FactoryQueueEntry, type FactoryStatus, getFactoryStatus } from "../../../../services/factory/factory.js";
import { listHeldEntries } from "../../../../services/outbox-apply/held-actions.js";
import { isAbandoned, listThreads, type ThreadRecord } from "../../../../services/thread/thread.js";
import type { ServiceContext } from "../../../../services/workspace/workspace.js";
import {
  type FullScreenConversationControl,
  useCovered,
  useFullScreenConversation,
} from "../../../components/index.js";
import {
  type AsyncState,
  type Layout,
  useAsync,
  useCursor,
  useEscape,
  useFactoryChanges,
  useIsActive,
  useLayout,
  useReportHints,
  useSharedFactoryStatus,
  useThreadChanges,
  useToast,
} from "../../../hooks/index.js";
import type { KeyHint } from "../../../keymap.js";
import { queueEntry } from "../../factory/index.js";
import { type ThreadHostView, threadHostView } from "../thread-host-view.js";
import { threadPanelTitle } from "../thread-panel/index.js";
import { type StageNames, sortThreads } from "../thread-text.js";
import { handleListKey, handleThreadKey, type ThreadsTabEnv } from "./threads-tab-actions.js";
import { hasHeld } from "./threads-tab-held.js";
import { type Focus, type HintsInput, threadsHints } from "./threads-tab-view.js";

/** No abandoned thread has held entries. */
const NO_HELD: Readonly<Record<string, number>> = {};

/** The conversation of a thread opens after the selection stays on the thread for this time. */
const OPEN_DELAY_MS = 200;

export interface ThreadsTabProps {
  readonly ctx: ServiceContext;
  readonly storyId: string;
  /** The names of the Stages by key. */
  readonly stages?: StageNames;
  /** This tab is the tab on the screen, and takes the keys. */
  readonly selected: boolean;
  /** Each thread of the list uses one line. */
  readonly compactThreads?: boolean;
  onCount(count: number): void;
  /** The thread region takes `esc`, so that the Modal does not close. */
  onEditing(editing: boolean): void;
  onHints(hints: readonly KeyHint[]): void;
}

interface ThreadsData {
  readonly threads: readonly ThreadRecord[];
  /** The number of held entries of each abandoned thread, by thread id. */
  readonly held: Readonly<Record<string, number>>;
}

/** The state of the Threads tab that its render reads. */
export interface ThreadsTabState {
  readonly env: ThreadsTabEnv;
  readonly data: AsyncState<ThreadsData | undefined>;
  readonly opened: boolean;
  readonly layout: Layout;
  readonly threads: readonly ThreadRecord[];
  readonly focus: Focus;
  readonly confirm: ThreadRecord | null;
  /** The thread of the open discard confirmation. */
  readonly discard: ThreadRecord | null;
  /** The live hosts and the host column of the list. */
  readonly hostView: ThreadHostView;
  readonly listing: boolean;
  readonly viewing: boolean;
  /** The steering input of the thread region takes the keys. */
  readonly steering: boolean;
  readonly waiting: FactoryQueueEntry | undefined;
  /** The provider pauses of the factory status, for the network reason of the queue note. */
  readonly providers: FactoryStatus["providers"];
  readonly now: number;
  readonly shownId: string | undefined;
  /** The conversation of the selected thread over the whole terminal, which `ctrl+f` opens. */
  readonly full: FullScreenConversationControl;
}

/** Reads the threads, but only after the tab is selected the first time. */
async function loadThreads(ctx: ServiceContext, storyId: string, opened: boolean): Promise<ThreadsData | undefined> {
  if (!opened) {
    return undefined;
  }

  const list = await listThreads({ story: storyId }, ctx);

  return { threads: sortThreads(list.threads), held: await heldCounts(ctx, list.threads) };
}

/** Reads the number of held entries of each abandoned thread. A read that fails gives no number. */
async function heldCounts(
  ctx: ServiceContext,
  threads: readonly ThreadRecord[],
): Promise<Readonly<Record<string, number>>> {
  const abandoned = threads.filter((thread) => isAbandoned(thread));
  const counts = await Promise.all(
    abandoned.map((thread) =>
      listHeldEntries({ id: thread.id }, ctx).then(
        (list) => [thread.id, list.entries.length] as const,
        () => undefined,
      ),
    ),
  );

  return Object.fromEntries(counts.filter((entry) => entry !== undefined));
}

/** Reads the factory status of the tab itself, only when no shell shares its status read. */
async function loadOwnStatus(ctx: ServiceContext, own: boolean): Promise<FactoryStatus | undefined> {
  return own ? getFactoryStatus(ctx).catch(() => undefined) : undefined;
}

/** The root of the Project of the tab, while the tab is on the screen. */
function watchRoot(ctx: ServiceContext, selected: boolean): string | undefined {
  return selected ? (ctx.cwd ?? process.cwd()) : undefined;
}

/** The threads of the Story, read again when the thread metadata changes. */
function useThreadList(ctx: ServiceContext, storyId: string, selected: boolean) {
  const [opened, setOpened] = useState(selected);

  useEffect(() => {
    if (selected) {
      setOpened(true);
    }
  }, [selected]);

  const data = useAsync(() => loadThreads(ctx, storyId, opened), [ctx, storyId, opened]);

  // The worker writes its thread from another process.
  useThreadChanges(watchRoot(ctx, selected), data.refresh);

  return { data, opened };
}

/**
 * The factory status. In the shell, it is the shared status read of the shell. A standalone tab reads the
 * status itself, and reads it again when the factory changes.
 */
function useTabStatus(ctx: ServiceContext, selected: boolean, opened: boolean): FactoryStatus | undefined {
  const shared = useSharedFactoryStatus();
  const own = shared === undefined && opened;
  const status = useAsync(() => loadOwnStatus(ctx, own), [ctx, own]);

  useFactoryChanges(own ? watchRoot(ctx, selected) : undefined, status.refresh);

  return shared === undefined ? status.data : shared.data;
}

/** The id of the selected thread, after the selection stays, so that `↑/↓` through the list opens no file. */
function useShownId(id: string | undefined): string | undefined {
  const [shownId, setShownId] = useState<string | undefined>(undefined);

  useEffect(() => {
    const timer = setTimeout(() => setShownId(id), OPEN_DELAY_MS);

    return () => clearTimeout(timer);
  }, [id]);

  return shownId;
}

/** The time that counts up each second while the tab is on the screen and a thread runs. */
function useNow(selected: boolean, running: boolean): number {
  const [now, setNow] = useState(Date.now);

  useEffect(() => {
    if (!selected || !running) {
      return;
    }

    const timer = setInterval(() => setNow(Date.now()), 1000);

    return () => clearInterval(timer);
  }, [selected, running]);

  return now;
}

/**
 * Tells the parent the count of threads and the editing state when they change. The thread region also edits while
 * its full-screen view is open, so that `esc` does not close the Modal.
 */
function useParentReports(props: ThreadsTabProps, data: ThreadsData | undefined, viewing: boolean): void {
  const { onCount, onEditing } = props;

  useEffect(() => {
    if (data) {
      onCount(data.threads.length);
    }
  }, [data, onCount]);
  useEffect(() => {
    onEditing(viewing);
  }, [viewing, onEditing]);
}

/** The focus after a change of the selected thread: the list without a thread, the thread when it stops running. */
function resetFocus(current: ThreadRecord | undefined, focus: Focus): Focus {
  if (!current) {
    return "list";
  }

  return focus === "steer" && current.status !== "running" ? "thread" : focus;
}

/** Goes back to the list when the selected thread goes away, and leaves the input when the thread stops running. */
function useFocusReset(current: ThreadRecord | undefined, focus: Focus, setFocus: (focus: Focus) => void): void {
  useEffect(() => {
    const next = resetFocus(current, focus);

    if (next !== focus) {
      setFocus(next);
    }
  }, [current, focus, setFocus]);
}

/** Gives the keys of the tab to the parent. While the full-screen view is open, the tab has no keys. */
function useTabHints(onHints: (hints: readonly KeyHint[]) => void, input: HintsInput, fullOpen: boolean): void {
  useReportHints(onHints, threadsHints({ ...input, keysOwn: input.keysOwn && !fullOpen }));
}

/**
 * The keys of the list and the thread region. `esc` in the thread region gives the focus back to the list. While the
 * steering input has the focus, the thread region takes no keys.
 */
function useTabKeys(
  env: ThreadsTabEnv,
  { viewing, steering, listing }: { readonly viewing: boolean; readonly steering: boolean; readonly listing: boolean },
): void {
  const regionKeys = viewing && !steering;

  useEscape(regionKeys, () => env.setFocus("list"));
  useInput((input, key) => handleThreadKey(env, input, key), { isActive: regionKeys });
  useInput((input, key) => handleListKey(env, input, key), { isActive: listing });
}

/** The conversation of the selected thread over the whole terminal. */
function useThreadFullScreen(
  { ctx, storyId, stages }: ThreadsTabProps,
  current: ThreadRecord | undefined,
): FullScreenConversationControl {
  return useFullScreenConversation({
    ctx,
    threadId: current?.id ?? "",
    live: current?.status === "running",
    title: threadPanelTitle(storyId, current, stages),
  });
}

/** The selected thread, its conversation and the time of the run times. */
function useTabSelection(props: ThreadsTabProps, threads: readonly ThreadRecord[], listing: boolean) {
  const [cursor, setCursor] = useCursor(threads.length, listing);
  const current = threads[cursor];
  const running = threads.some((thread) => thread.status === "running");
  const shownId = useShownId(current?.id);
  const now = useNow(props.selected, running);
  const conversation = props.selected && current !== undefined && shownId === current.id;
  const full = useThreadFullScreen(props, current);

  return { cursor, setCursor, current, shownId, now, conversation, full };
}

/** The confirmations of the tab: the interrupt and the discard of the held entries. */
function useTabDialogs() {
  const [confirm, setConfirm] = useState<ThreadRecord | null>(null);
  const [discard, setDiscard] = useState<ThreadRecord | null>(null);

  return { confirm, setConfirm, discard, setDiscard, open: confirm !== null || discard !== null };
}

/** The parts of the tab state that come from the factory status. */
function statusView(status: FactoryStatus | undefined, threads: readonly ThreadRecord[], storyId: string) {
  return {
    hostView: threadHostView(threads, status),
    waiting: queueEntry(status, storyId),
    providers: status?.providers,
  };
}

/** The state, the effects and the keys of the Threads tab. */
export function useThreadsTab(props: ThreadsTabProps): ThreadsTabState {
  const { ctx, storyId, stages, selected, onHints } = props;
  const active = useIsActive();
  const covered = useCovered();
  const layout = useLayout();
  const toast = useToast();
  const [focus, setFocus] = useState<Focus>("list");
  const dialogs = useTabDialogs();
  const sending = useRef(false);

  const { data, opened } = useThreadList(ctx, storyId, selected);
  const status = useTabStatus(ctx, selected, opened);
  const threads = data.data?.threads ?? [];
  const held = data.data?.held ?? NO_HELD;
  const keysOwn = active && selected && !covered && !dialogs.open;
  // The full-screen view opens only from the thread region, so the list never takes the keys while it is open.
  const listing = keysOwn && focus === "list" && data.data !== undefined;
  const { cursor, setCursor, current, shownId, now, conversation, full } = useTabSelection(props, threads, listing);
  const viewing = keysOwn && focus !== "list" && !full.isOpen;
  const steering = viewing && focus === "steer";

  const env: ThreadsTabEnv = {
    ctx,
    storyId,
    stages,
    toast,
    current,
    cursor,
    sending,
    refresh: data.refresh,
    setFocus,
    setConfirm: dialogs.setConfirm,
    held,
    setDiscard: dialogs.setDiscard,
    setCursor,
    openFullScreen: conversation ? full.open : undefined,
  };

  useParentReports(props, data.data, viewing || full.isOpen);
  useFocusReset(current, focus, setFocus);
  useTabKeys(env, { viewing, steering, listing });
  useTabHints(
    onHints,
    { keysOwn, viewing, steering, current, count: threads.length, conversation, held: hasHeld(current, held) },
    full.isOpen,
  );

  return {
    env,
    data,
    opened,
    layout,
    threads,
    focus,
    confirm: dialogs.confirm,
    discard: dialogs.discard,
    listing,
    viewing,
    steering,
    ...statusView(status, threads, storyId),
    now,
    shownId,
    full,
  };
}
