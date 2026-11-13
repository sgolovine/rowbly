import { useInput } from "ink";
import { useEffect, useRef, useState } from "react";
import { type FactoryQueueEntry, getFactoryStatus } from "../../../../services/factory/factory.js";
import { listThreads, type ThreadRecord } from "../../../../services/thread/thread.js";
import type { ServiceContext } from "../../../../services/workspace/workspace.js";
import { useCovered } from "../../../components/index.js";
import {
  type AsyncState,
  type Layout,
  useAsync,
  useCursor,
  useEscape,
  useFactoryChanges,
  useIsActive,
  useLayout,
  useToast,
} from "../../../hooks/index.js";
import type { KeyHint } from "../../../keymap.js";
import { queueEntry } from "../../factory/index.js";
import { type StageNames, sortThreads } from "../thread-text.js";
import { handleListKey, handleThreadKey, type ThreadsTabEnv } from "./threads-tab-actions.js";
import { type Focus, threadsHints } from "./threads-tab-view.js";

/** The conversation of a thread opens after the selection stays on the thread for this time. */
const OPEN_DELAY_MS = 200;

export interface ThreadsTabProps {
  readonly ctx: ServiceContext;
  readonly storyId: string;
  /** The names of the Stages by key. */
  readonly stages?: StageNames;
  /** This tab is the tab on the screen, and takes the keys. */
  readonly selected: boolean;
  onCount(count: number): void;
  /** The thread region takes `esc`, so that the Modal does not close. */
  onEditing(editing: boolean): void;
  onHints(hints: readonly KeyHint[]): void;
}

interface ThreadsData {
  readonly threads: readonly ThreadRecord[];
  readonly status: Awaited<ReturnType<typeof getFactoryStatus>> | undefined;
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
  readonly listing: boolean;
  readonly viewing: boolean;
  readonly waiting: FactoryQueueEntry | undefined;
  readonly now: number;
  readonly shownId: string | undefined;
}

/** Reads the threads and the factory status, but only after the tab is selected the first time. */
async function loadThreads(ctx: ServiceContext, storyId: string, opened: boolean): Promise<ThreadsData | undefined> {
  if (!opened) {
    return undefined;
  }

  const [list, status] = await Promise.all([
    listThreads({ story: storyId }, ctx),
    getFactoryStatus(ctx).catch(() => undefined),
  ]);

  return { threads: sortThreads(list.threads), status };
}

/** The threads of the Story, read again when the threads or the factory status change. */
function useThreadList(ctx: ServiceContext, storyId: string, selected: boolean) {
  const [opened, setOpened] = useState(selected);

  useEffect(() => {
    if (selected) {
      setOpened(true);
    }
  }, [selected]);

  const data = useAsync(() => loadThreads(ctx, storyId, opened), [ctx, storyId, opened]);

  // The worker writes its thread, and the factory its status, from another process.
  useFactoryChanges(selected ? (ctx.cwd ?? process.cwd()) : undefined, data.refresh);

  return { data, opened };
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

/** Tells the parent the count of threads and the editing state when they change. */
function useParentReports(props: ThreadsTabProps, data: ThreadsData | undefined, viewing: boolean): void {
  const { onCount, onEditing } = props;

  useEffect(() => {
    if (data) {
      onCount(data.threads.length);
    }
  }, [data, onCount]);
  useEffect(() => onEditing(viewing), [viewing, onEditing]);
}

/** Goes back to the list when the selected thread goes away. */
function useFocusReset(current: ThreadRecord | undefined, focus: Focus, setFocus: (focus: Focus) => void): void {
  useEffect(() => {
    if (!current && focus === "thread") {
      setFocus("list");
    }
  }, [current, focus, setFocus]);
}

/** Tells the parent the key hints when they change. */
function useHints(onHints: (hints: readonly KeyHint[]) => void, hints: readonly KeyHint[]): void {
  const hintsKey = JSON.stringify(hints);

  // biome-ignore lint/correctness/useExhaustiveDependencies: `hintsKey` stands in for `hints`, which is new on each render.
  useEffect(() => onHints(hints), [hintsKey, onHints]);
}

/** The state, the effects and the keys of the Threads tab. */
export function useThreadsTab(props: ThreadsTabProps): ThreadsTabState {
  const { ctx, storyId, stages, selected, onHints } = props;
  const active = useIsActive();
  const covered = useCovered();
  const layout = useLayout();
  const toast = useToast();
  const [focus, setFocus] = useState<Focus>("list");
  const [confirm, setConfirm] = useState<ThreadRecord | null>(null);
  const sending = useRef(false);

  const { data, opened } = useThreadList(ctx, storyId, selected);
  const threads = data.data?.threads ?? [];
  const keysOwn = active && selected && !covered && confirm === null;
  const listing = keysOwn && focus === "list" && data.data !== undefined;
  const viewing = keysOwn && focus === "thread";
  const [cursor, setCursor] = useCursor(threads.length, listing);
  const current = threads[cursor];
  const running = threads.some((thread) => thread.status === "running");
  const shownId = useShownId(current?.id);
  const now = useNow(selected, running);
  const hints = threadsHints({ keysOwn, viewing, current, count: threads.length });

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
    setConfirm,
    setCursor,
  };

  useParentReports(props, data.data, viewing);
  useFocusReset(current, focus, setFocus);
  useEscape(viewing, () => setFocus("list"));
  useInput((input, key) => handleThreadKey(env, input, key), { isActive: viewing });
  useInput((input, key) => handleListKey(env, input, key), { isActive: listing });
  useHints(onHints, hints);

  return {
    env,
    data,
    opened,
    layout,
    threads,
    focus,
    confirm,
    listing,
    viewing,
    waiting: queueEntry(data.data?.status, storyId),
    now,
    shownId,
  };
}
