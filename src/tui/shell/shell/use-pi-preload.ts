import { type RefObject, useEffect, useRef } from "react";
import { writeRef } from "../../hooks/refs.js";

/** The wait after the board first shows, so that Ink paints the board before the import blocks the thread. */
const PI_PRELOAD_DELAY_MS = 500;

function ignoreFailure(): undefined {
  return undefined;
}

/** Calls the preload one time. A failure shows nothing, because the Pi-backed views load the SDK again. */
function runPreload(started: RefObject<boolean>, preload: () => Promise<void>): void {
  writeRef(started, true);
  Promise.resolve()
    .then(() => preload())
    .catch(ignoreFailure);
}

/**
 * Starts `preload` one time, `PI_PRELOAD_DELAY_MS` after `ready` first becomes true. Nothing runs without
 * `preload`, so the tests and the onboarding state never import Pi. An unmount before the timer stops the call.
 */
export function usePiPreload(ready: boolean, preload: (() => Promise<void>) | undefined): void {
  const started = useRef(false);

  useEffect(() => {
    if (!ready || !preload || started.current) {
      return;
    }

    const timer = setTimeout(() => runPreload(started, preload), PI_PRELOAD_DELAY_MS);

    // The timer must not keep the process alive at exit.
    timer.unref?.();

    return () => clearTimeout(timer);
  }, [ready, preload]);
}
