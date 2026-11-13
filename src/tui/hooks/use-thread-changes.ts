import { useEffect } from "react";
import { watchThreads } from "../../services/thread/thread.js";

/** A crashed factory writes no file, so a factory watch also reads the status again after this time. */
const FACTORY_POLL_MS = 5000;

/**
 * Calls `onChange` when the thread metadata of the project at `root` changes, also from a different process.
 * With `factory`, a change of the factory status or owner also calls it, and so does a timer, because a
 * factory that stops without warning changes no file. Session histories do not call it. It watches nothing
 * while `root` is `undefined`. `onChange` must be a stable function, for example `refresh` from `useAsync`.
 */
export function useThreadChanges(root: string | undefined, onChange: () => void, factory = false): void {
  useEffect(() => {
    if (root === undefined) return;
    let stop: (() => void) | undefined;
    let mounted = true;
    watchThreads(onChange, { cwd: root }, { factory }).then(
      (unsubscribe) => {
        if (mounted) stop = unsubscribe;
        else unsubscribe();
      },
      () => {},
    );
    const timer = factory ? setInterval(onChange, FACTORY_POLL_MS) : undefined;
    timer?.unref?.();
    return () => {
      mounted = false;
      stop?.();
      clearInterval(timer);
    };
  }, [root, onChange, factory]);
}

/** Calls `onChange` when the factory status, its owner or the thread metadata changes. See `useThreadChanges`. */
export function useFactoryChanges(root: string | undefined, onChange: () => void): void {
  useThreadChanges(root, onChange, true);
}
