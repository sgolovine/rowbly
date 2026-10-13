/** The sidebar index a Board key selects: `[`/`]` step and wrap, `1`–`9` jump. */
export function boardKey(input: string, current: number, count: number): number | null {
  if (input === '[') return (Math.max(current, 0) - 1 + count) % count;
  if (input === ']') return (current + 1) % count;
  if (/^[1-9]$/.test(input) && Number(input) <= count) return Number(input) - 1;
  return null;
}
