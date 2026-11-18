import { useEffect } from "react";
import { type WatchChange, watchStories } from "../../services/story-watch/story-watch.js";
import { stopOnAbort } from "./stop-on-abort.js";

/**
 * Calls `onChange` when the Story files of the project at `root` change, also from a different process. `onChange`
 * gets the changed names of one quiet time, relative to `.rowbly/` (see `readStoryChanges`). It watches nothing while
 * `root` is `undefined`. `onChange` must be a stable function. If the watch cannot
 * start, the list still updates after the actions of the TUI. A change of the factory state file does not call
 * it, because the factory writes that file frequently. See `useFactoryStateChanges`.
 */
export function useStoryChanges(root: string | undefined, onChange: (changes: readonly WatchChange[]) => void): void {
  useEffect(() => {
    if (root === undefined) {
      return;
    }

    const live = new AbortController();

    watchStories(onChange, { cwd: root }, { includeState: false }).then(
      (unsubscribe) => stopOnAbort(live.signal, unsubscribe),
      () => {},
    );

    return () => live.abort();
  }, [root, onChange]);
}
