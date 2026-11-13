import { Box, Text, useInput } from "ink";
import { useEffect, useRef, useState } from "react";
import { getFactoryStatus, sendFactoryCommand } from "../../../../services/factory/factory.js";
import { listThreads, type ThreadRecord } from "../../../../services/thread/thread.js";
import type { ServiceContext } from "../../../../services/workspace/workspace.js";
import {
  ConfirmDialog,
  Loading,
  PANEL_FRAME_HEIGHT,
  Panel,
  ScrollBody,
  useCovered,
} from "../../../components/index.js";
import {
  useAsync,
  useCursor,
  useEscape,
  useFactoryChanges,
  useIsActive,
  useLayout,
  useToast,
} from "../../../hooks/index.js";
import type { KeyHint } from "../../../keymap.js";
import { theme } from "../../../theme.js";
import { queueEntry, queueReason } from "../../factory/index.js";
import { THREAD_DETAIL_ROWS, ThreadDetail } from "../ThreadDetail/index.js";
import { ThreadRow } from "../ThreadRow/index.js";
import { type StageNames, sortThreads, threadActive, threadName, threadResumable } from "../threadText.js";

/** The width of the thread list with its frame, and the gap after it. */
const LIST_WIDTH = 42;
const GAP = 1;
/** Below this width, the list and the thread take turns in one Panel. */
const SPLIT_MIN_WIDTH = LIST_WIDTH + GAP + 44;
/** Below this inner height, the thread shows its compact detail. */
const FULL_DETAIL_MIN_HEIGHT = THREAD_DETAIL_ROWS + 8;

type Focus = "list" | "thread";

/**
 * The threads of one Story: each Pi conversation that the factory recorded for it, also the pending, failed,
 * cancelled and interrupted ones. The list is on the left, and the selected thread on the right. In a narrow
 * Modal they take turns. The tab reads only metadata, and only after it is selected the first time. It reads
 * again when the threads or the factory status change. `x` asks before it interrupts an active thread, and `r`
 * resumes a resumable thread. The two keys send a command to the running factory. A note tells when the Story
 * waits for a worker slot.
 */
export function ThreadsTab({
  ctx,
  storyId,
  stages,
  selected,
  onCount,
  onEditing,
  onHints,
}: {
  ctx: ServiceContext;
  storyId: string;
  /** The names of the Stages by key. */
  stages?: StageNames;
  /** This tab is the tab on the screen, and takes the keys. */
  selected: boolean;
  onCount(count: number): void;
  /** The thread region takes `esc`, so that the Modal does not close. */
  onEditing(editing: boolean): void;
  onHints(hints: readonly KeyHint[]): void;
}) {
  const active = useIsActive();
  const covered = useCovered();
  const layout = useLayout();
  const toast = useToast();
  const [opened, setOpened] = useState(selected);
  const [focus, setFocus] = useState<Focus>("list");
  const [confirm, setConfirm] = useState<ThreadRecord | null>(null);
  const [now, setNow] = useState(Date.now);
  const sending = useRef(false);
  useEffect(() => {
    if (selected) setOpened(true);
  }, [selected]);

  const data = useAsync(async () => {
    if (!opened) return undefined;
    const [list, status] = await Promise.all([
      listThreads({ story: storyId }, ctx),
      getFactoryStatus(ctx).catch(() => undefined),
    ]);
    return { threads: sortThreads(list.threads), status };
  }, [ctx, storyId, opened]);
  // The worker writes its thread, and the factory its status, from another process.
  useFactoryChanges(selected ? (ctx.cwd ?? process.cwd()) : undefined, data.refresh);
  const threads = data.data?.threads ?? [];
  const keysOwn = active && selected && !covered && confirm === null;
  const listing = keysOwn && focus === "list" && data.data !== undefined;
  const viewing = keysOwn && focus === "thread";
  const [cursor, setCursor] = useCursor(threads.length, listing);
  const current = threads[cursor];
  const split = layout.width >= SPLIT_MIN_WIDTH;
  const waiting = queueEntry(data.data?.status, storyId);
  const running = threads.some((thread) => thread.status === "running");

  useEffect(() => {
    if (data.data) onCount(data.data.threads.length);
  }, [data.data, onCount]);
  useEffect(() => onEditing(viewing), [viewing, onEditing]);
  useEffect(() => {
    if (!current && focus === "thread") setFocus("list");
  }, [current, focus]);
  // The run time of a running thread counts up while the tab is on the screen.
  useEffect(() => {
    if (!selected || !running) return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [selected, running]);

  const command = async (type: "cancel" | "resume", thread: ThreadRecord) => {
    if (sending.current) return;
    sending.current = true;
    const name = `${storyId} ${threadName(thread, stages)}`;
    const progress = toast.pending(type === "cancel" ? `Interrupting ${name}…` : `Resuming ${name}…`);
    try {
      await sendFactoryCommand(type, { threadId: thread.id }, ctx);
      toast.push("info", type === "cancel" ? `Interrupted ${name}` : `Resumed ${name}`);
      data.refresh();
    } catch (error) {
      toast.error(error);
    } finally {
      toast.dismiss(progress);
      sending.current = false;
    }
  };
  const interrupt = () => {
    if (current && threadActive(current)) setConfirm(current);
  };
  const resume = () => {
    if (current && threadResumable(current)) void command("resume", current);
  };

  useEscape(viewing, () => setFocus("list"));
  useInput(
    (input, key) => {
      if (key.ctrl || key.meta) return;
      if (key.tab && !key.shift) setFocus("list");
      else if (input === "x") interrupt();
      else if (input === "r") resume();
    },
    { isActive: viewing },
  );
  useInput(
    (input, key) => {
      if (key.ctrl || key.meta) return;
      if (current && (key.return || (key.tab && !key.shift))) setFocus("thread");
      else if (input === "x") interrupt();
      else if (input === "r") resume();
    },
    { isActive: listing },
  );

  const actionHints: KeyHint[] = [
    ...(current && threadActive(current) ? [{ key: "x", description: "interrupt" }] : []),
    ...(current && threadResumable(current) ? [{ key: "r", description: "resume" }] : []),
  ];
  const hints: readonly KeyHint[] = !keysOwn
    ? []
    : viewing
      ? [...actionHints, { key: "esc", description: "back to Threads" }]
      : [
          ...(threads.length > 0 ? [{ key: "↑/↓", description: "select" }] : []),
          ...(current ? [{ key: "enter/tab", description: "open" }] : []),
          ...actionHints,
        ];
  const hintsKey = JSON.stringify(hints);
  // biome-ignore lint/correctness/useExhaustiveDependencies: `hintsKey` stands in for `hints`, which is new on each render.
  useEffect(() => onHints(hints), [hintsKey, onHints]);

  if (!data.data) return data.loading && opened ? <Loading label="Loading the threads…" /> : null;
  const innerHeight = layout.height === undefined ? undefined : layout.height - PANEL_FRAME_HEIGHT;
  const compact = innerHeight !== undefined && innerHeight < FULL_DETAIL_MIN_HEIGHT;
  const showList = split || focus === "list";
  const showThread = split || focus === "thread";
  return (
    <Box columnGap={GAP} height={layout.height}>
      {showList && (
        <Panel
          title="Threads"
          focused={listing}
          onClick={viewing ? () => setFocus("list") : undefined}
          flexShrink={0}
          width={split ? LIST_WIDTH : layout.width}
          height={layout.height}
          overflow="hidden"
        >
          {waiting && (
            <Text wrap="truncate-end" color={theme.inkMuted}>
              {queueReason(waiting).replace(/^./, (c) => c.toUpperCase())}
            </Text>
          )}
          {threads.length === 0 && <Text color={theme.inkFaint}>No Threads</Text>}
          <ScrollBody
            active={listing}
            height={innerHeight === undefined ? undefined : Math.max(1, innerHeight - (waiting ? 1 : 0))}
          >
            {threads.map((thread, i) => (
              <ThreadRow
                key={thread.id}
                thread={thread}
                stages={stages}
                now={now}
                selected={i === cursor}
                clickable={listing || viewing}
                onClick={() => {
                  if (i === cursor) setFocus("thread");
                  else {
                    setCursor(i);
                    setFocus("list");
                  }
                }}
              />
            ))}
          </ScrollBody>
        </Panel>
      )}
      {showThread && (
        <Panel
          title={current ? `${storyId} › ${threadName(current, stages)}` : "Thread"}
          focused={viewing}
          onClick={listing && current ? () => setFocus("thread") : undefined}
          flexGrow={1}
          flexShrink={1}
          width={split ? undefined : layout.width}
          height={layout.height}
          overflow="hidden"
        >
          {current ? (
            <ThreadDetail thread={current} now={now} compact={compact} />
          ) : (
            <Text color={theme.inkFaint} wrap="wrap">
              The factory adds a thread when it starts a worker for this Story.
            </Text>
          )}
        </Panel>
      )}
      {confirm && (
        <ConfirmDialog
          title={`${storyId} › Threads › Interrupt`}
          message={`Interrupt ${threadName(confirm, stages)}? The worker stops. Rowbly keeps its session and worktree, and r can resume it later.`}
          confirmLabel="Interrupt"
          cancelLabel="Cancel"
          destructive
          onConfirm={() => {
            setConfirm(null);
            void command("cancel", confirm);
          }}
          onCancel={() => setConfirm(null)}
        />
      )}
    </Box>
  );
}
