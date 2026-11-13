import { Store, withMember, withoutMember } from "../store/store.js";
import { queueRead } from "./conversation-read.js";
import { assertOpen, type ConversationEnv, type WatchRun, type WatchState } from "./conversation-state.js";
import type { ConversationPage } from "./session-types.js";

const POLL_MS = 500;

function ignoreError(): void {}

/** Calls `onChange` only when the page differs from the page that the watch gave last. */
function deliver(run: WatchRun, page: ConversationPage): void {
  const digest = JSON.stringify(page);
  const { active, previous } = run.store.current;

  if (!active || digest === previous) {
    return;
  }

  run.store.update(() => ({ previous: digest }));
  run.onChange(page);
}

async function poll(env: ConversationEnv, run: WatchRun): Promise<void> {
  const { active, busy } = run.store.current;

  if (!active || busy) {
    return;
  }

  run.store.update(() => ({ busy: true }));

  try {
    deliver(run, await queueRead(env, {}));
  } catch (error) {
    if (run.store.current.active) {
      run.onError(error);
    }
  } finally {
    run.store.update(() => ({ busy: false }));
  }
}

/** Stops one watch. A second call does nothing more. */
export function stopWatch(env: ConversationEnv, run: WatchRun): void {
  const { timer } = run.store.update(() => ({ active: false }));

  clearInterval(timer);
  env.store.update((state) => ({ watches: withoutMember(state.watches, run) }));
}

/** Reads the conversation now and every 500 ms. The timer does not keep the process alive. */
export function startWatch(
  env: ConversationEnv,
  onChange: (page: ConversationPage) => void,
  onError: (error: unknown) => void = ignoreError,
): () => void {
  assertOpen(env);

  const run: WatchRun = {
    onChange,
    onError,
    store: new Store<WatchState>({ active: true, busy: false, previous: "" }),
  };
  const timer = setInterval(() => void poll(env, run), POLL_MS);

  timer.unref();
  run.store.update(() => ({ timer }));
  env.store.update((state) => ({ watches: withMember(state.watches, run) }));
  void poll(env, run);

  return () => stopWatch(env, run);
}
