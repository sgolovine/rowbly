import { useInput } from 'ink';
import { useEffect, useState } from 'react';
import { moveDelta } from '../keymap';

/** A cursor over `length` rows, moved with `↑/↓`/`j/k` while `active`. */
export function useCursor(length: number, active: boolean): [number, (index: number) => void] {
  const [cursor, setCursor] = useState(0);
  const clamped = Math.max(0, Math.min(cursor, length - 1));
  useEffect(() => {
    if (clamped !== cursor) setCursor(clamped);
  }, [clamped, cursor]);
  useInput(
    (input, key) => {
      const delta = moveDelta(input, key);
      if (delta) setCursor(Math.max(0, Math.min(length - 1, clamped + delta)));
    },
    { isActive: active },
  );
  return [clamped, setCursor];
}
