import type { Dispatch, RefObject, SetStateAction } from "react";
import type { Conversation, ConversationEntry } from "../../../services/conversation/conversation.js";
import { runExclusive, type ToastStore } from "../../hooks/index.js";
import {
  type ConversationWindow,
  newerWindow,
  newestWindow,
  olderWindow,
  PAGE_ENTRIES,
} from "./conversation-window.js";

/** The state of the view after the last render, for reads that end after it. */
export interface LatestView {
  readonly view: ConversationWindow;
  readonly follow: boolean;
  readonly offset: number | "end";
}

/** The refs, the setters and the helpers that the reads of a `ConversationView` use. */
export interface ReadEnv {
  readonly conversation: RefObject<Conversation | undefined>;
  /** A read is in progress; the view runs one read at a time. */
  readonly reading: RefObject<boolean>;
  readonly latest: RefObject<LatestView>;
  readonly toast: ToastStore;
  readonly setView: Dispatch<SetStateAction<ConversationWindow>>;
  readonly setOffset: Dispatch<SetStateAction<number | "end">>;
  /** The rows of `entries` at the width of the last render. */
  readonly rowsOf: (entries: readonly ConversationEntry[]) => number;
}

/** Reads the newest page again and shows the end. */
export async function readEnd(env: ReadEnv): Promise<void> {
  const c = env.conversation.current;

  if (!c) {
    return;
  }

  const page = await c.read({ limit: PAGE_ENTRIES });

  env.setView(newestWindow(page));
  env.setOffset("end");
}

/** Runs one read at a time. A cursor that left the branch reads the end again. */
export async function readExclusive(env: ReadEnv, task: (c: Conversation) => Promise<void>): Promise<void> {
  const c = env.conversation.current;

  if (!c) {
    return;
  }

  await runExclusive(env.reading, () => readSafely(env, c, task));
}

async function readSafely(env: ReadEnv, c: Conversation, task: (c: Conversation) => Promise<void>): Promise<void> {
  try {
    await task(c);
  } catch (error) {
    await recoverRead(env, error);
  }
}

/** A cursor that left the branch reads the end again, before the next read can start. Other errors show a toast. */
async function recoverRead(env: ReadEnv, error: unknown): Promise<void> {
  if (error instanceof Error && error.message.includes("no longer available")) {
    await readEnd(env).catch(() => {});

    return;
  }

  env.toast.error(error);
}

async function readOlder(env: ReadEnv, c: Conversation): Promise<void> {
  const { view: now } = env.latest.current;
  const first = now.entries[0];

  if (!first || !now.older) {
    return;
  }

  const page = await c.read({ before: first.id, limit: PAGE_ENTRIES });
  // The rows above the view grow, so the view moves down by the same rows and stays on the same text.
  const added = env.rowsOf(page.entries);

  env.setOffset((o) => (o === "end" ? o : o + added));
  env.setView(olderWindow(now, page));
}

async function readNewer(env: ReadEnv, c: Conversation): Promise<void> {
  const { view: now } = env.latest.current;
  const last = now.entries.at(-1);

  if (!last || !now.newer) {
    return;
  }

  const page = await c.read({ after: last.id, limit: PAGE_ENTRIES });
  const { window, dropped } = newerWindow(now, page);
  // The rows above the view leave, so the view moves up by the same rows and stays on the same text.
  const removed = env.rowsOf(dropped);

  env.setOffset((o) => (o === "end" ? o : Math.max(0, o - removed)));
  env.setView(window);
}

/** Reads the page before the window. */
export function loadOlder(env: ReadEnv): Promise<void> {
  return readExclusive(env, (c) => readOlder(env, c));
}

/** Reads the page after the window. */
export function loadNewer(env: ReadEnv): Promise<void> {
  return readExclusive(env, (c) => readNewer(env, c));
}
