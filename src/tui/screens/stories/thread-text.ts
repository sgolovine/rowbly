import type { ThreadRecord, ThreadStatus } from "../../../services/thread/thread.js";
import { theme } from "../../theme.js";

/** The glyph of each thread status and its token. Failed is `danger`; the others are plain text. */
export const THREAD_GLYPHS: Record<ThreadStatus, { glyph: string; color: string }> = {
  pending: { glyph: "·", color: theme.inkMuted },
  running: { glyph: "▶", color: theme.ink },
  completed: { glyph: "✓", color: theme.inkMuted },
  failed: { glyph: "✕", color: theme.danger },
  cancelled: { glyph: "✕", color: theme.inkMuted },
  interrupted: { glyph: "!", color: theme.stageBoard },
};

/** True while a thread takes a worker slot: pending or running. */
export function threadActive(thread: ThreadRecord): boolean {
  return thread.status === "pending" || thread.status === "running";
}

/** True when the factory can resume the thread: a resumable thread that stopped. */
export function threadResumable(thread: ThreadRecord): boolean {
  return thread.resumable && !threadActive(thread) && thread.session.file !== null;
}

/** Active threads first, then the newest threads, so that history goes to the bottom. */
export function sortThreads(threads: readonly ThreadRecord[]): ThreadRecord[] {
  return [...threads].sort(
    (a, b) =>
      Number(threadActive(b)) - Number(threadActive(a)) ||
      b.createdAt.localeCompare(a.createdAt) ||
      a.id.localeCompare(b.id),
  );
}

/** The names of the Stages by key. A thread keeps the key of a Stage that is gone; it shows that key. */
export type StageNames = Readonly<Record<string, string>>;

/** The Stage of a thread by its name, for example `In Review`. */
function threadStage(thread: ThreadRecord, stages: StageNames = {}): string {
  return thread.stage ? (stages[thread.stage] ?? thread.stage) : "—";
}

/** The name of a thread for people: `#2 In Review` for a worker, `Supervisor` for the supervisor. */
export function threadName(thread: ThreadRecord, stages: StageNames = {}): string {
  if (thread.role === "supervisor") {
    return "Supervisor";
  }
  return `${thread.attemptNumber ? `#${thread.attemptNumber} ` : ""}${threadStage(thread, stages)}`;
}

/** `provider/model`, or `model not set` before the factory resolves the model. */
export function threadModel(thread: ThreadRecord): string {
  return thread.model ? `${thread.model.provider}/${thread.model.modelId}` : "model not set";
}

/** A duration in the largest two units: `45s`, `4m 12s`, `2h 5m`, `3d 4h`. */
export function formatDuration(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  if (s < 60) {
    return `${s}s`;
  }
  const m = Math.floor(s / 60);
  if (m < 60) {
    return `${m}m ${s % 60}s`;
  }
  const h = Math.floor(m / 60);
  if (h < 24) {
    return `${h}h ${m % 60}m`;
  }
  return `${Math.floor(h / 24)}d ${h % 24}h`;
}

/** The run time of the thread: from its start to its end, or to `now` while it runs. Empty before a start. */
export function threadDuration(thread: ThreadRecord, now: number): string {
  if (!thread.startedAt) {
    return "";
  }
  const end = thread.completedAt ? Date.parse(thread.completedAt) : threadActive(thread) ? now : undefined;
  return end === undefined ? "" : formatDuration(end - Date.parse(thread.startedAt));
}

/** One line about the result: the error, the summary of the worker, or the reason of the last run. */
export function threadOutcome(thread: ThreadRecord): { text: string; error: boolean } | undefined {
  if (thread.error) {
    return { text: thread.error.message, error: true };
  }
  if (thread.result) {
    return { text: `${thread.result.outcome}: ${thread.result.summary}`, error: false };
  }
  const reason = thread.runs.at(-1)?.reason;
  return reason ? { text: reason, error: false } : undefined;
}
