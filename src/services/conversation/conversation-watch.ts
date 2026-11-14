import { Store, withMember, withoutMember } from "../store/store.js";
import { getThread, type ThreadRecord } from "../thread/thread.js";
import { fileProblem, queueRead } from "./conversation-read.js";
import { sessionSignature, threadSignature, watchSignature } from "./conversation-signature.js";
import { assertOpen, type ConversationEnv, type WatchRun, type WatchState } from "./conversation-state.js";
import type { ConversationPage } from "./session-types.js";

const POLL_MS = 500;

function ignoreError(): void {}

/**
 * Gives a small digest of a page. Session files are append-only, so an entry ID does not change its text.
 * A replaced file resets the index and gives different entries.
 */
function pageDigest(page: ConversationPage): string {
  const ids = page.entries.map((entry) => entry.id);

  return [page.status, page.invalidLines, page.nextBefore ?? "", page.entries.length, ...ids].join("\n");
}

/** Calls `onChange` only when the page differs from the page that the watch gave last. */
function deliver(run: WatchRun, page: ConversationPage): void {
  const digest = pageDigest(page);
  const { active, previous } = run.store.current;

  if (!active || digest === previous) {
    return;
  }

  run.store.update(() => ({ previous: digest }));
  run.onChange(page);
}

/**
 * Gives the Thread record for a full read of the watch. It reads the Thread file again only when its
 * signature changed. Then it records the signature of the session file before the page read, so a later
 * change of the file always gives a different signature.
 */
async function loadWatchThread(env: ConversationEnv, run: WatchRun, signature: string): Promise<ThreadRecord> {
  const cached = run.store.current;
  const thread =
    cached.thread && cached.threadSignature === signature ? cached.thread : await getThread(env.threadId, env.ctx);
  const session = await sessionSignature(env, thread);

  run.store.update(() => ({ thread, threadSignature: signature, pending: watchSignature(signature, session) }));

  return thread;
}

/** Stops before the Thread read and the page read when no file changed since the last successful poll. */
async function refresh(env: ConversationEnv, run: WatchRun): Promise<void> {
  const signature = await threadSignature(env);
  const { thread, signature: last } = run.store.current;

  const current = watchSignature(signature, await sessionSignature(env, thread));

  if (thread && current === last) {
    return;
  }

  const page = await queueRead(env, {}, () => loadWatchThread(env, run, signature));

  run.store.update((state) => ({ signature: state.pending, pending: undefined }));
  deliver(run, page);
}

/** Forgets the cached Thread and the signatures, so the next poll does the full read again. */
function forgetSignature(run: WatchRun): void {
  run.store.update(() => ({ thread: undefined, threadSignature: undefined, pending: undefined, signature: undefined }));
}

async function poll(env: ConversationEnv, run: WatchRun): Promise<void> {
  const { active, busy } = run.store.current;

  if (!active || busy) {
    return;
  }

  run.store.update(() => ({ busy: true }));

  try {
    await refresh(env, run).catch(fileProblem);
  } catch (error) {
    forgetSignature(run);

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
