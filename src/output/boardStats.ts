import type { BoardStat } from '../services/boardStats';

/** The qualifier is part of the value, so a lower bound cannot look like an exact total. */
export function boardStatText(metric: BoardStat): string {
  if (metric.status === 'unavailable') return `unavailable · ${metric.reason}`;
  if (metric.status === 'partial') return `${metric.value} known (partial) · ${metric.reason}`;
  return String(metric.value);
}
