import { Store } from "../store/store.js";

/** The promise of the last item that started. */
interface Gate {
  readonly last: Promise<unknown>;
}

/** Starts `action` for `item` when the action of the previous item ends. */
function chain<T, R>(gate: Store<Gate>, action: (item: T) => Promise<R>, item: T): Promise<R> {
  const run = gate.current.last.then(() => action(item));

  gate.update(() => ({ last: run }));

  return run;
}

/**
 * Runs `action` on each item, one at a time, in order, as a plain loop with `await` does. A failure stops the
 * later items. The results come back in one pass, so a long list does not copy a growing array.
 */
export function mapInOrder<T, R>(items: readonly T[], action: (item: T) => Promise<R>): Promise<R[]> {
  const gate = new Store<Gate>({ last: Promise.resolve() });

  return Promise.all(items.map((item) => chain(gate, action, item)));
}
