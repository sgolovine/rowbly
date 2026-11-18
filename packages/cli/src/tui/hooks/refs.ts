import { type RefObject, useRef } from "react";

/** Gives a ref a new value. A ref is the one value of a component that React lets change in place. */
export function writeRef<T>(ref: RefObject<T>, value: T): void {
  // biome-ignore lint/plugin: React refs change in place by design. This is the one place that writes a ref.
  ref.current = value;
}

/** Gives a ref that holds the value of the last render, for callbacks that outlive the render. */
export function useLatest<T>(value: T): RefObject<T> {
  const ref = useRef(value);

  writeRef(ref, value);

  return ref;
}

/** Runs `task`, unless an earlier task with the same `busy` ref has not finished. */
export async function runExclusive(busy: RefObject<boolean>, task: () => Promise<void>): Promise<void> {
  if (busy.current) {
    return;
  }

  writeRef(busy, true);

  try {
    await task();
  } finally {
    writeRef(busy, false);
  }
}
