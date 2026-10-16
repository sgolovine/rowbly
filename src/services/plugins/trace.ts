import type { Change } from './types';

/**
 * The opt-in operation trace (OBS-01). `ROWBLY_DEBUG=trace` turns it on: the CLI writes each event
 * to stderr as it happens, the TUI keeps the latest events and writes them to stderr when it exits.
 *
 * An event names where Plugin code ran and how it went: the operation, the Plugin, the stage, the
 * time it took, its outcome, the error code of a failure and the number of changes a commit saved.
 * It never holds an input, a bag, settings, a record, file text, an error message or editor text.
 * When the trace is off, nothing is measured, built or kept.
 */
export interface TraceEvent {
  /** One per operation (`op-3`); a callback outside an operation has one of its own. */
  operationId: string;
  /** Such as `stories.create`, or the stage of a callback outside an operation (`command`). */
  operation: string;
  /** The Plugin whose callback ran; `null` for the operation as a whole or its commit. */
  plugin: string | null;
  /** A stage of ADR-0020 §1, or `operation` for the whole operation. */
  stage: string;
  /** Elapsed milliseconds. */
  ms: number;
  /** `rejected`: a guard refused the operation. `timeout`: a reaction ran past its deadline. */
  outcome: 'ok' | 'failed' | 'rejected' | 'timeout';
  /** The error code of a failure or rejection, such as `CONFLICT`. */
  code?: string;
  /** For a failed operation: the Plugin and stage the error names, when it names one. */
  failedAt?: { plugin: string | null; stage: string };
  /** For a commit: how many changes of each type it saved, such as `{ story: 2, file: 1 }`. */
  changes?: Record<string, number>;
}

export type TraceSink = (event: TraceEvent) => void;

let sink: TraceSink | undefined;

/** Turns the trace on with `next`, or off with `undefined`. */
export function setTraceSink(next: TraceSink | undefined): void {
  sink = next;
}

/** Whether the trace is on; callers measure time only when it is. */
export function tracing(): boolean {
  return sink !== undefined;
}

/** Records one event, when the trace is on. */
export function trace(event: TraceEvent): void {
  sink?.(event);
}

/** A millisecond clock for the trace. */
export function traceClock(): number {
  return performance.now();
}

/** Whether `ROWBLY_DEBUG` asks for the trace: `trace`, alone or in a comma-separated list. */
export function traceRequested(env: Readonly<Record<string, string | undefined>>): boolean {
  return (env.ROWBLY_DEBUG ?? '').split(',').some((part) => part.trim() === 'trace');
}

/** The outcome and code of a callback or operation that threw `err`. */
export function failure(err: unknown): Pick<TraceEvent, 'outcome' | 'code' | 'failedAt'> {
  const { code, details } = (typeof err === 'object' && err !== null ? err : {}) as {
    code?: unknown;
    details?: { plugin?: unknown; stage?: unknown };
  };
  const rejected = details?.stage === 'guard' && code === 'CONFLICT';
  return {
    outcome: rejected ? 'rejected' : 'failed',
    ...(typeof code === 'string' ? { code } : {}),
    ...(typeof details?.stage === 'string'
      ? { failedAt: { plugin: typeof details.plugin === 'string' ? details.plugin : null, stage: details.stage } }
      : {}),
  };
}

/** How many changes of each type `changes` holds. */
export function countChanges(changes: readonly Change[]): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const change of changes) counts[change.type] = (counts[change.type] ?? 0) + 1;
  return counts;
}

/** One line of the trace: `rowbly trace op-3 stories.create transform plugin=epics ok 0.4 ms`. */
export function formatTrace(event: TraceEvent): string {
  const parts = ['rowbly trace', event.operationId, event.operation, event.stage];
  if (event.plugin !== null) parts.push(`plugin=${event.plugin}`);
  parts.push(event.outcome);
  if (event.code) parts.push(`code=${event.code}`);
  if (event.failedAt) {
    parts.push(`at=${event.failedAt.stage}${event.failedAt.plugin ? `:${event.failedAt.plugin}` : ''}`);
  }
  if (event.changes) {
    const counts = Object.entries(event.changes).map(([type, n]) => `${type}:${n}`);
    parts.push(`changes=${counts.join(',') || 'none'}`);
  }
  parts.push(`${event.ms.toFixed(1)} ms`);
  return parts.join(' ');
}

/** A trace sink that keeps the latest `limit` events, for the TUI, which owns the terminal. */
export function traceBuffer(limit = 1000): { sink: TraceSink; lines(): string[] } {
  const events: TraceEvent[] = [];
  let dropped = 0;
  return {
    sink(event) {
      events.push(event);
      if (events.length > limit) {
        events.shift();
        dropped += 1;
      }
    },
    lines() {
      const lines = events.map(formatTrace);
      return dropped > 0 ? [`rowbly trace: ${dropped} earlier events dropped`, ...lines] : lines;
    },
  };
}
