import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Conversation, ConversationEntry, openConversation } from "../../../services/conversation/conversation.js";
import type { ServiceContext } from "../../../services/workspace/workspace.js";
import { useLatest, useToast } from "../../hooks/index.js";
import { useMarkdownRenderer } from "../use-markdown-renderer.js";
import type { ReadEnv } from "./conversation-reads.js";
import { openWindow, watchWindow } from "./conversation-session.js";
import { type ConversationWindow, type EntryBlock, LOADING } from "./conversation-window.js";
import { cachedLines, type LineCache, pruneLines } from "./line-cache.js";

export interface ConversationWindowOptions {
  readonly ctx: ServiceContext;
  readonly threadId: string;
  readonly live: boolean;
  readonly width: number;
  readonly open: typeof openConversation;
}

/**
 * The window of entries of a conversation: it opens the thread, reads the first page, follows a running thread,
 * and keeps the rows of each entry.
 */
export function useConversationWindow({ ctx, threadId, live, width, open }: ConversationWindowOptions) {
  const toast = useToast();
  const [view, setView] = useState<ConversationWindow>(LOADING);
  const [opened, setOpened] = useState(0);
  // `end` keeps the last row in view; a number is the first row in view.
  const [offset, setOffset] = useState<number | "end">("end");
  const [follow, setFollow] = useState(live);
  const conversation = useRef<Conversation | undefined>(undefined);
  const reading = useRef(false);
  const latest = useLatest({ view, follow, offset });
  const render = useMarkdownRenderer();
  const cache = useRef<LineCache>(new Map());

  const linesOf = useCallback((entry: ConversationEntry) => cachedLines(cache, entry, width, render), [width, render]);
  const blocks: readonly EntryBlock[] = useMemo(
    () => view.entries.map((entry) => ({ entry, lines: linesOf(entry) })),
    [view.entries, linesOf],
  );
  const env: ReadEnv = {
    conversation,
    reading,
    latest,
    toast,
    setView,
    setOffset,
    rowsOf: (entries) => entries.reduce((n, entry) => n + linesOf(entry).length, 0),
  };

  useEffect(
    () =>
      pruneLines(
        cache,
        blocks.map((block) => block.entry),
        width,
        render,
      ),
    [blocks, width, render],
  );
  useEffect(
    () => openWindow({ open, threadId, ctx, conversation, cache, setView, setOffset, setOpened }),
    [threadId, ctx, open],
  );
  // biome-ignore lint/correctness/useExhaustiveDependencies: `opened` restarts the watch for each opened conversation.
  useEffect(() => watchWindow(conversation, live, setView, latest), [live, opened]);
  useEffect(() => {
    if (!live) {
      setFollow(false);
    }
  }, [live]);

  return { view, offset, follow, setFollow, blocks, env };
}
