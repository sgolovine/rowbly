/** Runs `action` on each item, one at a time, in order. The file system sees the same order as a plain loop. */
export async function mapInOrder<T, R>(items: readonly T[], action: (item: T) => Promise<R>): Promise<R[]> {
  const [first, ...rest] = items;

  if (first === undefined) {
    return [];
  }

  const head = await action(first);

  return [head, ...(await mapInOrder(rest, action))];
}
