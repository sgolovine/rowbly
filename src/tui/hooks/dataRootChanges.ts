import { createContext, useContext, useEffect, useRef, useState } from 'react';
import type { DataRoot } from '../../schemas';
import { watchDataRoot } from '../../storage';
import type { ToastStore } from './toasts';

/**
 * How many times the open Data Root changed on disk since the app started: a write by the CLI,
 * another Rowbly, an editor, or this app. A screen reloads what it shows when it changes.
 */
export const DataRootChangesContext = createContext(0);

/** The change count of the open Data Root; `0` until it changes, and always outside the App. */
export function useDataRootChanges(): number {
  return useContext(DataRootChangesContext);
}

/**
 * Watches `root` while it is open and counts its changes. `onChange` runs first with the changed
 * paths (`null`: unknown), e.g. to load the Plugins again when `rowbly.config.json` changed. A
 * watcher that fails shows a warning; the app keeps working and watches again once it can.
 * Switching to another Data Root, or unmounting, closes the watcher.
 */
export function useDataRootWatch(
  root: DataRoot | undefined,
  toasts: ToastStore,
  onChange: (paths: readonly string[] | null) => void,
): number {
  const [changes, setChanges] = useState(0);
  const latest = useRef(onChange);
  latest.current = onChange;
  const path = root?.path;
  // biome-ignore lint/correctness/useExhaustiveDependencies: only another Data Root restarts the watcher.
  useEffect(() => {
    if (!root) return;
    return watchDataRoot(root, {
      onChange(paths) {
        latest.current(paths);
        setChanges((n) => n + 1);
      },
      onError(err) {
        const reason = err instanceof Error ? err.message : String(err);
        toasts.push('warning', `Not watching the Data Root for changes: ${reason}`);
      },
    });
  }, [path, toasts]);
  return changes;
}
