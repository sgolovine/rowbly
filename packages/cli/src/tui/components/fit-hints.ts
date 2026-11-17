import type { KeyHint } from "../keymap.js";

function hintWidth(hint: KeyHint): number {
  return [...hint.key].length + 1 + [...hint.description].length;
}

/** The columns `hints` take in a row of `KeyHints`. */
export function hintsWidth(hints: readonly KeyHint[]): number {
  return hints.reduce((sum, hint, i) => sum + hintWidth(hint) + (i > 0 ? 2 : 0), 0);
}

/** The hints that fit in `width` columns: later ones go first, but a last `esc` hint stays. */
export function fitHints(hints: readonly KeyHint[], width: number): readonly KeyHint[] {
  const pinned = hints.at(-1)?.key === "esc" ? hints.slice(-1) : [];
  const free = hints.slice(0, hints.length - pinned.length);
  // From all hints down to the first free hint and the pinned hint, which always stay.
  const candidates = free.map((_, dropped) => [...free.slice(0, free.length - dropped), ...pinned]);

  return candidates.find((kept) => hintsWidth(kept) <= width) ?? candidates.at(-1) ?? [...hints];
}
