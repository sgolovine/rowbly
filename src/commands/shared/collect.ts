/** Commander argument parser that collects every occurrence of a repeatable flag. */
export function collect(value: string, previous: string[] = []): string[] {
  return [...previous, value];
}
