import { type Key, useInput } from "ink";
import { type Dispatch, type SetStateAction, useEffect, useState } from "react";
import { moveDelta } from "../keymap.js";

function moveCursor(
  setCursor: Dispatch<SetStateAction<number>>,
  length: number,
  clamped: number,
  input: string,
  key: Key,
): void {
  const delta = moveDelta(input, key);

  if (delta) {
    setCursor(Math.max(0, Math.min(length - 1, clamped + delta)));
  }
}

/** A cursor over `length` rows, moved with `↑/↓` (or `j/k`) while `active`. */
export function useCursor(length: number, active: boolean): [number, (index: number) => void] {
  const [cursor, setCursor] = useState(0);
  const clamped = Math.max(0, Math.min(cursor, length - 1));

  useEffect(() => {
    if (clamped !== cursor) {
      setCursor(clamped);
    }
  }, [clamped, cursor]);
  useInput((input, key) => moveCursor(setCursor, length, clamped, input, key), { isActive: active });

  return [clamped, setCursor];
}
