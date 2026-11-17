import { Text } from "ink";
import { useSyncExternalStore } from "react";
import { createFrameClock } from "../../../services/frame-clock/frame-clock.js";
import { theme } from "../../theme.js";

const FRAMES = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];

/** One clock for all Spinners, so that all of them move in one commit, and no timer runs without a Spinner. */
const clock = createFrameClock({ frameCount: FRAMES.length, intervalMs: 80 });

/** A braille spinner in `accent` that moves on every 80 ms. */
export function Spinner() {
  const frame = useSyncExternalStore(clock.subscribe, clock.frame);

  return <Text color={theme.accent}>{FRAMES[frame]}</Text>;
}

/** A spinner with a label, for screens waiting on a service. */
export function Loading({ label = "Loading…" }: { label?: string }) {
  return (
    <Text>
      <Spinner /> {label}
    </Text>
  );
}
