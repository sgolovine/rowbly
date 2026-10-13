const UNITS: readonly [string, number][] = [
  ['y', 365 * 24 * 3600],
  ['mo', 30 * 24 * 3600],
  ['d', 24 * 3600],
  ['h', 3600],
  ['m', 60],
];

/** `just now`, `5m ago`, `3h ago`, `2d ago`, `4mo ago`, `1y ago`. */
export function relativeTime(timestamp: string, now: Date): string {
  const seconds = Math.max(0, Math.floor((now.getTime() - new Date(timestamp).getTime()) / 1000));
  for (const [unit, size] of UNITS) {
    if (seconds >= size) return `${Math.floor(seconds / size)}${unit} ago`;
  }
  return 'just now';
}
