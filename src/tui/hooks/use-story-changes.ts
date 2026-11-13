import { useEffect } from "react";
import { watchStories } from "../../services/story-watch/story-watch.js";

/**
 * Calls `onChange` when the Story files of the project at `root` change, also from a different process. It
 * watches nothing while `root` is `undefined`. `onChange` must be a stable function. If the watch cannot
 * start, the list still updates after the actions of the TUI.
 */
export function useStoryChanges(root: string | undefined, onChange: () => void): void {
  useEffect(() => {
    if (root === undefined) {
      return;
    }
    let stop: (() => void) | undefined;
    let mounted = true;
    watchStories(onChange, { cwd: root }).then(
      (unsubscribe) => {
        if (mounted) {
          stop = unsubscribe;
        } else {
          unsubscribe();
        }
      },
      () => {},
    );
    return () => {
      mounted = false;
      stop?.();
    };
  }, [root, onChange]);
}
