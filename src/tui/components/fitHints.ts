import type { KeyHint } from '../keymap';

const length = (hint: KeyHint) => [...hint.key].length + 1 + [...hint.description].length;
const total = (hints: readonly KeyHint[]) => hints.reduce((sum, hint, i) => sum + length(hint) + (i > 0 ? 2 : 0), 0);

/** The hints that fit in `width` columns: later ones go first, but a last `esc` hint stays. */
export function fitHints(hints: readonly KeyHint[], width: number): readonly KeyHint[] {
  const kept = [...hints];
  const pinned = kept.at(-1)?.key === 'esc' ? 1 : 0;
  while (kept.length > pinned + 1 && total(kept) > width) kept.splice(kept.length - pinned - 1, 1);
  return kept;
}
