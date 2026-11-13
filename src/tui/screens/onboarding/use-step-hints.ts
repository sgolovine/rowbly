import { useEffect } from "react";
import type { KeyHint } from "../../keymap.js";

/** Sends the keys of an onboarding step to the footer of the Shell. */
export function useStepHints(onHints: (hints: readonly KeyHint[]) => void, hints: readonly KeyHint[]): void {
  const key = JSON.stringify(hints);
  // biome-ignore lint/correctness/useExhaustiveDependencies: `key` stands in for `hints`, which callers rebuild each render.
  useEffect(() => onHints(hints), [onHints, key]);
}
