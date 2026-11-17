import type { Dispatch, RefObject, SetStateAction } from "react";
import type { Conversation, ConversationPage, openConversation } from "../../../services/conversation/conversation.js";
import type { ServiceContext } from "../../../services/workspace/workspace.js";
import { writeRef } from "../../hooks/index.js";
import type { LatestView } from "./conversation-reads.js";
import {
  type ConversationWindow,
  errorWindow,
  LOADING,
  newestWindow,
  PAGE_ENTRIES,
  watchedWindow,
} from "./conversation-window.js";
import type { LineCache } from "./line-cache.js";

/** What the view needs to open the conversation of a thread and to close it again. */
export interface OpenEnv {
  readonly open: typeof openConversation;
  readonly threadId: string;
  readonly ctx: ServiceContext;
  readonly conversation: RefObject<Conversation | undefined>;
  readonly cache: RefObject<LineCache>;
  readonly setView: Dispatch<SetStateAction<ConversationWindow>>;
  readonly setOffset: Dispatch<SetStateAction<number | "end">>;
  /** Counts the opened conversations, so that the watch starts again for each one. */
  readonly setOpened: Dispatch<SetStateAction<number>>;
}

async function readFirstPage(env: OpenEnv, signal: AbortSignal): Promise<void> {
  try {
    const c = await env.open(env.threadId, env.ctx);

    if (signal.aborted) {
      c.close();

      return;
    }

    writeRef(env.conversation, c);

    const page = await c.read({ limit: PAGE_ENTRIES });

    if (signal.aborted) {
      return;
    }

    env.setView(newestWindow(page));
    env.setOpened((n) => n + 1);
  } catch (error) {
    if (!signal.aborted) {
      env.setView(errorWindow(error));
    }
  }
}

/** Closes the conversation of the view, its index and its watch, and drops the cached rows. */
function closeWindow(env: OpenEnv, live: AbortController): void {
  live.abort();
  env.conversation.current?.close();
  writeRef(env.conversation, undefined);
  writeRef(env.cache, new Map());
}

/** Opens the thread and reads its newest page. Gives the cleanup that closes it when the view closes or the thread changes. */
export function openWindow(env: OpenEnv): () => void {
  const live = new AbortController();

  env.setView(LOADING);
  env.setOffset("end");
  void readFirstPage(env, live.signal);

  return () => closeWindow(env, live);
}

function watchListener(
  setView: Dispatch<SetStateAction<ConversationWindow>>,
  latest: RefObject<LatestView>,
): (page: ConversationPage) => void {
  return (page) => setView((now) => watchedWindow(now, page, latest.current.follow));
}

/** Watches a running thread: the watch reads the end of the history when the file changes. Gives the stop of the watch. */
export function watchWindow(
  conversation: RefObject<Conversation | undefined>,
  live: boolean,
  setView: Dispatch<SetStateAction<ConversationWindow>>,
  latest: RefObject<LatestView>,
): (() => void) | undefined {
  const c = conversation.current;

  if (!live || !c) {
    return undefined;
  }

  return c.watch(watchListener(setView, latest), () => {});
}
