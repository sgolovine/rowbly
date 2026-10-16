import { useEffect, useRef } from 'react';
import { useIsActive } from './shell';

/**
 * Calls `reload` once each time the screen becomes active again, e.g. after a screen pushed on top
 * of it is closed; never when it mounts or loses focus. A tab or section that is active only part of
 * the time passes its own `active` flag instead of the screen's (ARCH-26, DX-25).
 */
export function useReloadOnReturn(reload: () => void, active?: boolean): void {
  const screenActive = useIsActive();
  const now = active ?? screenActive;
  const wasActive = useRef(now);
  useEffect(() => {
    if (now && !wasActive.current) reload();
    wasActive.current = now;
  }, [now, reload]);
}
