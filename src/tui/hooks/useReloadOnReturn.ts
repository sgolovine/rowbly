import { useEffect, useRef } from 'react';
import { useIsActive } from './shell';

/** Calls `reload` when the screen becomes active again, e.g. after a pushed screen is closed. */
export function useReloadOnReturn(reload: () => void): void {
  const active = useIsActive();
  const wasActive = useRef(active);
  useEffect(() => {
    if (active && !wasActive.current) reload();
    wasActive.current = active;
  }, [active, reload]);
}
