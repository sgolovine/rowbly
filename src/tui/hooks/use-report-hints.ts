import { useEffect } from "react";
import type { KeyHint } from "../keymap.js";

/** Gives `hints` to the parent when their content changes, not on each render. */
export function useReportHints(onHints: (hints: readonly KeyHint[]) => void, hints: readonly KeyHint[]): void {
  const hintsKey = JSON.stringify(hints);

  // biome-ignore lint/correctness/useExhaustiveDependencies: `hintsKey` stands in for `hints`, which is new on each render.
  useEffect(() => onHints(hints), [hintsKey, onHints]);
}
