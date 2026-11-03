import { isSlug } from '../../core';
import type { BoardStatDefinition } from './types';

/** Keep safe labels even when the host rejected the Plugin's declaration. */
export function boardStatDefinitions(value: unknown): BoardStatDefinition[] {
  if (!Array.isArray(value)) return [];
  const metrics: BoardStatDefinition[] = [];
  const keys = new Set<string>();
  for (const metric of value) {
    if (
      !metric ||
      typeof metric.key !== 'string' ||
      !isSlug(metric.key) ||
      typeof metric.label !== 'string' ||
      !metric.label.trim() ||
      metric.label.length > 100 ||
      keys.has(metric.key)
    )
      continue;
    keys.add(metric.key);
    metrics.push({ key: metric.key, label: metric.label });
    if (metrics.length === 16) break;
  }
  return metrics;
}
