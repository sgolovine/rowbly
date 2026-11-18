import { useEffect } from "react";
import { watchFactoryState } from "../../services/story-watch/story-watch.js";
import { stopOnAbort } from "./stop-on-abort.js";

/**
 * Calls `onChange` when the factory state file of the project at `root` changes, also from a different
 * process. It watches nothing while `root` is `undefined`. `onChange` must be a stable function. If the watch
 * cannot start, the factory activity still updates when the board loads again.
 */
export function useFactoryStateChanges(root: string | undefined, onChange: () => void): void {
  useEffect(() => {
    if (root === undefined) {
      return;
    }

    const live = new AbortController();

    watchFactoryState(onChange, { cwd: root }).then(
      (unsubscribe) => stopOnAbort(live.signal, unsubscribe),
      () => {},
    );

    return () => live.abort();
  }, [root, onChange]);
}
