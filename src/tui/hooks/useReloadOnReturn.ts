import { useEffect, useRef } from 'react';
import { useDataRootChanges } from './dataRootChanges';
import { useIsActive } from './shell';

/**
 * Calls `reload` once each time the screen becomes active again, e.g. after a screen pushed on top
 * of it is closed, and each time the Data Root changes on disk while it is active (by the CLI,
 * another Rowbly or an editor); never when it mounts or loses focus. A change while it is inactive
 * reloads it once, on return. A tab or section that is active only part of the time passes its own
 * `active` flag instead of the screen's (ARCH-26, DX-25).
 */
export function useReloadOnReturn(reload: () => void, active?: boolean): void {
  const screenActive = useIsActive();
  const now = active ?? screenActive;
  const changes = useDataRootChanges();
  const wasActive = useRef(now);
  const seen = useRef(changes);
  useEffect(() => {
    if (now && (!wasActive.current || seen.current !== changes)) reload();
    wasActive.current = now;
    if (now) seen.current = changes;
  }, [now, reload, changes]);
}
