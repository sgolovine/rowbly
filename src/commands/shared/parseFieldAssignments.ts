import { UsageError } from '../../core';

export function parseFieldAssignments(values: readonly string[] | undefined): Record<string, string> {
  const result: Record<string, string> = {};
  for (const value of values ?? []) {
    let currentKey: string | undefined;
    for (const segment of value.split(',')) {
      const eq = segment.indexOf('=');
      if (eq === -1) {
        if (currentKey === undefined)
          throw new UsageError(`invalid --field "${value}"`, { hint: 'expected key=value' });
        result[currentKey] = `${result[currentKey]},${segment}`;
        continue;
      }
      currentKey = segment.slice(0, eq).trim();
      if (currentKey === '') throw new UsageError(`invalid --field "${value}"`, { hint: 'expected key=value' });
      result[currentKey] = segment.slice(eq + 1).trim();
    }
  }
  return result;
}
