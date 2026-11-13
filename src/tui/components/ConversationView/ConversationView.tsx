import { Box, type DOMElement, Text, useInput } from "ink";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  type Conversation,
  type ConversationPage,
  type ConversationEntry as Entry,
  openConversation,
} from "../../../services/conversation/conversation.js";
import type { ServiceContext } from "../../../services/workspace/workspace.js";
import { useIsActive, useMouse, useToast, WHEEL_LINES } from "../../hooks/index.js";
import type { KeyHint } from "../../keymap.js";
import { moveDelta } from "../../keymap.js";
import { theme } from "../../theme.js";
import { ConversationEntry } from "../ConversationEntry/index.js";
import { type ConversationLine, conversationLines } from "../conversationLines.js";
import { loadMarkdownRenderer, markdownRenderer, plainMarkdownRows } from "../markdown.js";

/** The entries of one read. */
const PAGE_ENTRIES = 20;
/** The most entries that the view keeps: three pages. It drops the entries furthest from the view. */
const MAX_ENTRIES = 3 * PAGE_ENTRIES;

/** The keys of a `ConversationView` in focus, for the hints of its screen. `live` adds `f`. */
export function conversationKeys(live: boolean): KeyHint[] {
  return [
    { key: "↑/↓", description: "scroll" },
    ...(live ? [{ key: "f", description: "follow" }] : []),
    { key: "pgup/pgdn", description: "page" },
    { key: "home/end", description: "oldest/newest", secondary: true },
  ];
}

interface Window {
  entries: Entry[];
  /** The history has entries before the first entry of the window. */
  older: boolean;
  /** The history has entries after the last entry of the window. */
  newer: boolean;
  /** New entries arrived while the view was not at the end. */
  fresh: boolean;
  status: ConversationPage["status"] | "loading" | "error";
  error?: string;
}

const LOADING: Window = { entries: [], older: false, newer: false, fresh: false, status: "loading" };

/**
 * A read-only view of the Pi conversation of one thread. It opens only the file of that thread, reads pages of
 * 20 entries and keeps at most three pages. It reads older pages when the view reaches the top, and newer pages
 * when it reaches the end. It never starts an agent. Each entry shows its label and time, the text, the tool
 * calls and the tool results. While the thread runs (`live`), the view follows the new entries. A scroll up
 * stops this, so the history stays in place; `end` or `f` follows again. `↑/↓`, `pgup/pgdn`, the wheel and
 * `home/end` scroll. When the view closes or the thread changes, the conversation, its index and its watch close.
 */
export function ConversationView({
  ctx,
  threadId,
  live,
  active,
  width,
  height,
  open = openConversation,
}: {
  ctx: ServiceContext;
  threadId: string;
  /** The thread runs: new entries can arrive. */
  live: boolean;
  /** The view takes the keys and the wheel. */
  active: boolean;
  width: number;
  /** The rows of the view with its status row. Without it, all rows of the window show. */
  height?: number;
  /** Opens the conversation; tests replace it. */
  open?: typeof openConversation;
}) {
  const keys = useIsActive() && active;
  const toast = useToast();
  const [view, setView] = useState<Window>(LOADING);
  const [opened, setOpened] = useState(0);
  // `end` keeps the last row in view; a number is the first row in view.
  const [offset, setOffset] = useState<number | "end">("end");
  const [follow, setFollow] = useState(live);
  const conversation = useRef<Conversation | undefined>(undefined);
  const reading = useRef(false);
  const latest = useRef({ view, follow, offset });
  latest.current = { view, follow, offset };
  const [render, setRender] = useState(markdownRenderer);
  useEffect(() => {
    if (render) return;
    let current = true;
    void loadMarkdownRenderer().then((loaded) => current && setRender(() => loaded));
    return () => {
      current = false;
    };
  }, [render]);

  // The rows of each entry, kept by entry, width and renderer. Entries that leave the window leave the cache.
  const cache = useRef(new Map<string, ConversationLine[]>());
  const linesOf = useCallback(
    (entry: Entry) => {
      const key = `${entry.id}:${width}:${render ? 1 : 0}`;
      let lines = cache.current.get(key);
      if (!lines) {
        lines = conversationLines(entry, width, render ?? plainMarkdownRows);
        cache.current.set(key, lines);
      }
      return lines;
    },
    [width, render],
  );
  const blocks = useMemo(
    () => view.entries.map((entry) => ({ entry, lines: linesOf(entry) })),
    [view.entries, linesOf],
  );
  useEffect(() => {
    const keep = new Set(blocks.map((block) => `${block.entry.id}:${width}:${render ? 1 : 0}`));
    for (const key of cache.current.keys()) if (!keep.has(key)) cache.current.delete(key);
  }, [blocks, width, render]);
  const total = blocks.reduce((n, block) => n + block.lines.length, 0);
  const rowsOf = (entries: readonly Entry[]) => entries.reduce((n, entry) => n + linesOf(entry).length, 0);

  // Open the thread, and close it when the view closes or the thread changes.
  useEffect(() => {
    let alive = true;
    let opening: Conversation | undefined;
    setView(LOADING);
    setOffset("end");
    open(threadId, ctx)
      .then(async (c) => {
        opening = c;
        if (!alive) return c.close();
        conversation.current = c;
        const page = await c.read({ limit: PAGE_ENTRIES });
        if (!alive) return;
        setView({
          entries: page.entries,
          older: page.nextBefore !== null,
          newer: false,
          fresh: false,
          status: page.status,
        });
        setOpened((n) => n + 1);
      })
      .catch((error: unknown) => {
        if (alive)
          setView({ ...LOADING, status: "error", error: error instanceof Error ? error.message : String(error) });
      });
    return () => {
      alive = false;
      opening?.close();
      conversation.current = undefined;
      cache.current.clear();
    };
  }, [threadId, ctx, open]);

  /** Reads the newest page again and shows the end. */
  const toEnd = useCallback(async () => {
    const c = conversation.current;
    if (!c) return;
    const page = await c.read({ limit: PAGE_ENTRIES });
    setView({
      entries: page.entries,
      older: page.nextBefore !== null,
      newer: false,
      fresh: false,
      status: page.status,
    });
    setOffset("end");
  }, []);

  /** Runs one read at a time. A cursor that left the branch reads the end again. */
  const read = useCallback(
    async (task: (c: Conversation) => Promise<void>) => {
      const c = conversation.current;
      if (!c || reading.current) return;
      reading.current = true;
      try {
        await task(c);
      } catch (error) {
        if (error instanceof Error && error.message.includes("no longer available")) await toEnd().catch(() => {});
        else toast.error(error);
      } finally {
        reading.current = false;
      }
    },
    [toEnd, toast],
  );

  const loadOlder = () =>
    read(async (c) => {
      const { view: now } = latest.current;
      const first = now.entries[0];
      if (!first || !now.older) return;
      const page = await c.read({ before: first.id, limit: PAGE_ENTRIES });
      const entries = [...page.entries, ...now.entries];
      const kept = entries.slice(0, MAX_ENTRIES);
      // The rows above the view grow, so the view moves down by the same rows and stays on the same text.
      const added = rowsOf(page.entries);
      setOffset((o) => (o === "end" ? o : o + added));
      setView({
        ...now,
        entries: kept,
        older: page.nextBefore !== null,
        newer: now.newer || kept.length < entries.length,
      });
    });

  const loadNewer = () =>
    read(async (c) => {
      const { view: now } = latest.current;
      const last = now.entries.at(-1);
      if (!last || !now.newer) return;
      const page = await c.read({ after: last.id, limit: PAGE_ENTRIES });
      const entries = [...now.entries, ...page.entries];
      const dropped = entries.slice(0, Math.max(0, entries.length - MAX_ENTRIES));
      const removed = rowsOf(dropped);
      setOffset((o) => (o === "end" ? o : Math.max(0, o - removed)));
      const newer = page.nextAfter !== null && page.nextAfter !== undefined;
      setView({
        ...now,
        entries: entries.slice(dropped.length),
        older: now.older || dropped.length > 0,
        newer,
        fresh: newer && now.fresh,
      });
    });

  // A running thread: the watch reads the end of the history when the file changes.
  // biome-ignore lint/correctness/useExhaustiveDependencies: `opened` restarts the watch for each opened conversation.
  useEffect(() => {
    const c = conversation.current;
    if (!live || !c) return;
    return c.watch(
      (page) =>
        setView((now) => {
          if (now.status === "loading" || now.status === "error") return now;
          const last = now.entries.at(-1)?.id;
          const at = last === undefined ? -1 : page.entries.findIndex((entry) => entry.id === last);
          const added = at >= 0 ? page.entries.slice(at + 1) : page.entries;
          if (added.length === 0 && page.status === now.status) return now;
          // While the user reads the history, the new entries wait below, and the view does not move.
          if (!latest.current.follow || now.newer) return { ...now, newer: true, fresh: true };
          if (at < 0)
            return {
              entries: page.entries,
              older: page.nextBefore !== null,
              newer: false,
              fresh: false,
              status: page.status,
            };
          const entries = [...now.entries, ...added];
          return {
            ...now,
            entries: entries.slice(-MAX_ENTRIES),
            older: now.older || entries.length > MAX_ENTRIES,
            status: page.status,
          };
        }),
      () => {},
    );
  }, [live, opened]);
  useEffect(() => {
    if (!live) setFollow(false);
  }, [live]);

  const rows = height === undefined ? total : Math.max(1, height - 1);
  const max = Math.max(0, total - rows);
  const start = offset === "end" ? max : Math.max(0, Math.min(offset, max));
  // The top of the window is in view: read the page before it.
  // biome-ignore lint/correctness/useExhaustiveDependencies: a read starts only when the view reaches the top.
  useEffect(() => {
    if (height !== undefined && start === 0 && view.older && view.status === "ok") void loadOlder();
  }, [start, view.older, view.status, height]);

  const scroll = (delta: number) => {
    if (delta < 0) setFollow(false);
    const next = start + delta;
    if (next > max && view.newer) void loadNewer();
    setOffset(Math.max(0, Math.min(max, next)));
  };
  const end = () => {
    setFollow(live);
    if (view.newer) void read(toEnd);
    else setOffset("end");
  };
  useInput(
    (input, key) => {
      if (key.ctrl || key.meta) return;
      if (key.pageUp || key.pageDown) scroll((key.pageUp ? -1 : 1) * rows);
      else if (key.home) {
        setFollow(false);
        setOffset(0);
      } else if (key.end) end();
      else if (input === "f" && live) {
        if (follow) setFollow(false);
        else end();
      } else {
        const delta = moveDelta(input, key);
        if (delta) scroll(delta);
      }
    },
    { isActive: keys },
  );
  const ref = useRef<DOMElement>(null);
  useMouse(ref, { onWheel: (direction) => scroll(direction * WHEEL_LINES) }, keys);

  if (view.status === "loading") return <Text color={theme.inkFaint}>Loading the conversation…</Text>;
  if (view.status === "error")
    return (
      <Text color={theme.danger} wrap="wrap">
        Rowbly cannot read the conversation: {view.error}
      </Text>
    );
  if (view.status === "missing")
    return <Text color={theme.inkFaint}>No conversation yet. The worker has not sent its first message.</Text>;
  if (view.status === "unsupported") return <Text color={theme.inkFaint}>Rowbly cannot show this session format.</Text>;

  // The entries in view, each cut to its rows in view.
  const shown: { id: string; lines: ConversationLine[] }[] = [];
  let row = 0;
  for (const block of blocks) {
    const from = Math.max(start - row, 0);
    const to = Math.min(start + rows - row, block.lines.length);
    if (from < to) shown.push({ id: block.entry.id, lines: block.lines.slice(from, to) });
    row += block.lines.length;
  }
  const atEnd = start >= max && !view.newer;
  const status = [
    total > 0 ? `${start + 1}–${Math.min(total, start + rows)} of ${total} rows` : "No entries",
    view.older ? "↑ older" : undefined,
    view.fresh ? "↓ new entries" : view.newer ? "↓ newer" : undefined,
    live ? (follow && atEnd ? "following" : "f follow") : undefined,
  ].filter(Boolean);
  return (
    <Box ref={ref} flexDirection="column" flexShrink={0}>
      {shown.map((part) => (
        <ConversationEntry key={part.id} lines={part.lines} />
      ))}
      {height !== undefined && total < rows && <Box height={rows - total} />}
      <Text color={theme.inkFaint} wrap="truncate-end">
        {status.join(" · ")}
      </Text>
    </Box>
  );
}
