import { Store } from "../store/store.js";

/** The promise of the last item that started. */
interface Gate {
  readonly last: Promise<unknown>;
}

/** Starts `action` for `item` when the action of the previous item ends. */
function chain<T, R>(
  gate: Store<Gate>,
  action: (item: T, index: number) => Promise<R>,
  item: T,
  index: number,
): Promise<R> {
  const run = gate.current.last.then(() => action(item, index));

  gate.update(() => ({ last: run }));

  return run;
}

/**
 * Runs `action` on each item and its index, one at a time, in order, as a plain loop with `await` does. A failure
 * stops the later items. The results come back in one pass, so a long list does not copy a growing array.
 */
export function mapInOrder<T, R>(items: readonly T[], action: (item: T, index: number) => Promise<R>): Promise<R[]> {
  const gate = new Store<Gate>({ last: Promise.resolve() });

  return Promise.all(items.map((item, index) => chain(gate, action, item, index)));
}
