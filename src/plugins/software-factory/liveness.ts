import { UsageError } from '../../plugin-api';

/** How long a running Stage Run may go without reported activity before it is stale (ADR-0048 §2). */
export const DEFAULT_STALE_AFTER_MINUTES = 15;

/**
 * When a running Stage Run's worker was last seen. `lastSeenAt` is the heartbeat's time, or `null`
 * when none was reported for this Run; the age then counts from the Run's start. `heartbeat` is
 * `unavailable` when the Run's saved record cannot be read, so no heartbeat can be known.
 */
export interface Liveness {
  lastSeenAt: string | null;
  heartbeat: 'reported' | 'none' | 'unavailable';
  ageSeconds: number;
  stale: boolean;
}

export function liveness(
  run: { startedAt: string },
  heartbeat: { at: string } | null | 'unavailable',
  now: Date,
  staleAfterMinutes: number,
): Liveness {
  const lastSeenAt = heartbeat && heartbeat !== 'unavailable' ? heartbeat.at : null;
  const ageSeconds = Math.max(0, Math.floor((now.getTime() - Date.parse(lastSeenAt ?? run.startedAt)) / 1000));
  const state = heartbeat === 'unavailable' ? 'unavailable' : lastSeenAt ? 'reported' : 'none';
  return { lastSeenAt, heartbeat: state, ageSeconds, stale: ageSeconds >= staleAfterMinutes * 60 };
}

/** What the `runs` digest sees of a Liveness: everything but the age, which changes on every read. */
export function stableLiveness(value: Liveness | null): Omit<Liveness, 'ageSeconds'> | null {
  if (!value) return null;
  const { ageSeconds: _age, ...rest } = value;
  return rest;
}

/** `--stale-after <minutes>`: a positive number of minutes. */
export function parseStaleAfter(value: string | undefined): number {
  if (value === undefined) return DEFAULT_STALE_AFTER_MINUTES;
  const minutes = Number(value);
  if (!/^\d+(\.\d+)?$/.test(value.trim()) || minutes <= 0)
    throw new UsageError('--stale-after takes a positive number of minutes');
  return minutes;
}

/** A Liveness in a few words, for the `runs` table and the Stage Run tab. */
export function livenessText(value: Liveness | null): string {
  if (!value) return '—';
  const age = ageText(value.ageSeconds);
  const seen =
    value.heartbeat === 'unavailable'
      ? `unavailable (run doctor), started ${age} ago`
      : value.lastSeenAt
        ? `${age} ago`
        : `not reported, started ${age} ago`;
  return value.stale ? `${seen}, stale` : seen;
}

function ageText(seconds: number): string {
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  return hours < 48 ? `${hours}h ${minutes % 60}m` : `${Math.floor(hours / 24)}d`;
}
