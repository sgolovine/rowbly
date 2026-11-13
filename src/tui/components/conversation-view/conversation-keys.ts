import type { Key } from "ink";
import type { Dispatch, SetStateAction } from "react";
import { type KeyHint, moveDelta } from "../../keymap.js";
import { loadNewer, type ReadEnv, readEnd, readExclusive } from "./conversation-reads.js";
import type { ConversationWindow, Viewport } from "./conversation-window.js";

/** The state of the view that the keys and the wheel use, with the environment of the reads. */
export interface ViewEnv extends ReadEnv {
  readonly view: ConversationWindow;
  readonly port: Viewport;
  /** The thread runs: new entries can arrive. */
  readonly live: boolean;
  readonly follow: boolean;
  readonly setFollow: Dispatch<SetStateAction<boolean>>;
}

/** The keys of a `ConversationView` in focus, for the hints of its screen. `live` adds `f`. */
export function conversationKeys(live: boolean): KeyHint[] {
  return [
    { key: "↑/↓", description: "scroll" },
    ...(live ? [{ key: "f", description: "follow" }] : []),
    { key: "pgup/pgdn", description: "page" },
    { key: "home/end", description: "oldest/newest", secondary: true },
  ];
}

/** Scrolls `delta` rows. A scroll up stops the follow; a scroll below the window reads the newer page. */
export function scrollBy(env: ViewEnv, delta: number): void {
  const { start, max } = env.port;
  const next = start + delta;

  if (delta < 0) {
    env.setFollow(false);
  }

  if (next > max && env.view.newer) {
    void loadNewer(env);
  }

  env.setOffset(Math.max(0, Math.min(max, next)));
}

/** Shows the end of the history, and follows it while the thread runs. */
function showEnd(env: ViewEnv): void {
  env.setFollow(env.live);

  if (env.view.newer) {
    void readExclusive(env, () => readEnd(env));

    return;
  }

  env.setOffset("end");
}

function toggleFollow(env: ViewEnv): void {
  if (env.follow) {
    env.setFollow(false);

    return;
  }

  showEnd(env);
}

/** The keys of a `ConversationView`: `↑/↓`, `pgup/pgdn`, `home/end` and `f`. */
export function handleConversationKey(env: ViewEnv, input: string, key: Key): void {
  const delta = moveDelta(input, key);

  if (key.ctrl || key.meta) {
    return;
  }

  if (key.pageUp || key.pageDown) {
    scrollBy(env, (key.pageUp ? -1 : 1) * env.port.rows);

    return;
  }

  if (key.home) {
    env.setFollow(false);
    env.setOffset(0);

    return;
  }

  if (key.end) {
    showEnd(env);

    return;
  }

  if (input === "f" && env.live) {
    toggleFollow(env);

    return;
  }

  if (delta) {
    scrollBy(env, delta);
  }
}
