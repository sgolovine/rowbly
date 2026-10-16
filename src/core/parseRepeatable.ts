/**
 * Flattens a repeatable flag that may also be comma-separated: `['a,b', 'c']` → `['a', 'b', 'c']`.
 * Trims, drops empty entries and duplicates, and keeps first-seen order. Opt-in: Plugin option values
 * are not split unless the Plugin's converter calls this (CQ-03), so text with commas stays literal.
 */
export function parseRepeatable(values: string | readonly string[] | undefined): string[] {
  const list = typeof values === 'string' ? [values] : (values ?? []);
  const items = list.flatMap((value) => value.split(',')).map((item) => item.trim());
  return [...new Set(items.filter((item) => item !== ''))];
}
