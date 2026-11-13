import { WHEEL_LINES } from "../hooks/index.js";

/** `offset` kept within `0` and `max`. */
export function clampOffset(offset: number, max: number): number {
  return Math.max(0, Math.min(max, offset));
}

/**
 * The offset after one notch of the wheel. Several notches can arrive before a render, so each one scrolls
 * from the latest offset, also when the last render made `max` smaller.
 */
export function wheelOffset(current: number, max: number, direction: number): number {
  return clampOffset(Math.min(current, max) + direction * WHEEL_LINES, max);
}
