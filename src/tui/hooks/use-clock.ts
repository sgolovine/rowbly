import { useEffect, useState } from "react";

/** The time between two ticks of the clock. */
const TICK_MS = 1000;

/**
 * The time, which counts up each second while `enabled`, for the run time of a running Thread. While it is not
 * enabled, the clock stops, so an idle or a covered view does not render again. When it starts again, it reads the
 * time at once, so that the run time is correct immediately.
 */
export function useClock(enabled: boolean): number {
  const [now, setNow] = useState(Date.now);

  useEffect(() => {
    if (!enabled) {
      return;
    }

    setNow(Date.now());

    const timer = setInterval(() => setNow(Date.now()), TICK_MS);

    return () => clearInterval(timer);
  }, [enabled]);

  return now;
}
