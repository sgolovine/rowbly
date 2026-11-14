import { useEffect } from "react";
import { watchThreads } from "../../services/thread/thread.js";
import { stopOnAbort } from "./stop-on-abort.js";

/** A crashed factory writes no file, so a factory watch also reads the status again after this time without a read. */
const FACTORY_POLL_MS = 5000;

/** A factory read: it calls `onChange`, and starts the timer again, so the timer reads only after a quiet period. */
interface FactoryPoll {
  readonly read: () => void;
  readonly timer: NodeJS.Timeout;
}

function readAndRestart(timer: NodeJS.Timeout, onChange: () => void): void {
  timer.refresh();
  onChange();
}

/** Starts the timer of a factory watch. A read from a file event or from the timer starts it again. */
function startFactoryPoll(onChange: () => void): FactoryPoll {
  const timer: NodeJS.Timeout = setTimeout(() => readAndRestart(timer, onChange), FACTORY_POLL_MS);

  timer.unref?.();

  return { read: () => readAndRestart(timer, onChange), timer };
}

/**
 * Calls `onChange` when the thread metadata of the project at `root` changes, also from a different process.
 * With `factory`, a change of the factory status or owner also calls it, and so does a timer 5 s after the last
 * call, because a factory that stops without warning changes no file. Session histories do not call it. It
 * watches nothing while `root` is `undefined`. `onChange` must be a stable function, for example `refresh`
 * from `useAsync`.
 */
export function useThreadChanges(root: string | undefined, onChange: () => void, factory = false): void {
  useEffect(() => {
    if (root === undefined) {
      return;
    }

    const live = new AbortController();
    const poll = factory ? startFactoryPoll(onChange) : undefined;

    watchThreads(poll?.read ?? onChange, { cwd: root }, { factory }).then(
      (unsubscribe) => stopOnAbort(live.signal, unsubscribe),
      () => {},
    );

    return () => {
      live.abort();
      clearTimeout(poll?.timer);
    };
  }, [root, onChange, factory]);
}

/** Calls `onChange` when the factory status, its owner or the thread metadata changes. See `useThreadChanges`. */
export function useFactoryChanges(root: string | undefined, onChange: () => void): void {
  useThreadChanges(root, onChange, true);
}
