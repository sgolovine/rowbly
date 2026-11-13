/**
 * Holds one immutable value that concurrent tasks share. An update never changes the current value.
 * It replaces the value with a new frozen object.
 */
export class Store<T extends object> {
  #value: Readonly<T>;

  constructor(initial: T) {
    this.#value = Object.freeze({ ...initial });
  }

  get current(): Readonly<T> {
    return this.#value;
  }

  /** Merges the changes from `change` into a new value, and gives the new value. */
  update(change: (current: Readonly<T>) => Partial<T>): Readonly<T> {
    // biome-ignore lint/plugin: the store cell is the one place where the shared state changes.
    this.#value = Object.freeze({ ...this.#value, ...change(this.#value) });

    return this.#value;
  }
}

/** Gives a new map with the entry set. The source map does not change. */
export function withEntry<K, V>(map: ReadonlyMap<K, V>, key: K, value: V): ReadonlyMap<K, V> {
  return new Map([...map, [key, value]]);
}

/** Gives a new map without the entry. The source map does not change. */
export function withoutEntry<K, V>(map: ReadonlyMap<K, V>, key: K): ReadonlyMap<K, V> {
  return new Map([...map].filter(([entryKey]) => entryKey !== key));
}

/** Gives a new map without the entries that match. The source map does not change. */
export function withoutEntries<K, V>(map: ReadonlyMap<K, V>, matches: (value: V) => boolean): ReadonlyMap<K, V> {
  return new Map([...map].filter(([, value]) => !matches(value)));
}

/** Gives a new set with the value added. The source set does not change. */
export function withMember<T>(set: ReadonlySet<T>, value: T): ReadonlySet<T> {
  return new Set([...set, value]);
}

/** Gives a new set without the value. The source set does not change. */
export function withoutMember<T>(set: ReadonlySet<T>, value: T): ReadonlySet<T> {
  return new Set([...set].filter((member) => member !== value));
}
