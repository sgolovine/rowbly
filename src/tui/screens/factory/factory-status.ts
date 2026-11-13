import type { FactoryQueueEntry, FactoryStatus } from "../../../services/factory/factory.js";
import { formatDateTime } from "../../theme.js";

/** One item that asks for the attention of a person. */
export interface FactoryProblem {
  key: string;
  text: string;
}

/** True when a factory process owns the Project and has not stopped. A status file of a stopped factory is old. */
export function factoryLive(status: FactoryStatus | undefined): boolean {
  return status !== undefined && ["starting", "ready", "stopping"].includes(status.phase) && status.liveness !== "dead";
}

/**
 * The short state of the factory for the header: `off`, `starting`, `2/4 · 1 pending` and the other phases.
 * It is `…` until the first read completes. `short` leaves out the pending count.
 */
export function factoryState(status: FactoryStatus | undefined, short = false): string {
  if (!status) {
    return "…";
  }
  if (status.phase === "stopped") {
    return "off";
  }
  if (status.phase !== "ready" || !status.workers) {
    return status.phase;
  }
  const { running, pending, limit } = status.workers;
  return pending > 0 && !short ? `${running}/${limit} · ${pending} pending` : `${running}/${limit}`;
}

/**
 * The problems of a factory that runs: its attention items, the providers that it paused and a heartbeat that
 * stopped. A stopped factory has no problems, because its status file is old.
 */
export function factoryProblems(status: FactoryStatus | undefined): FactoryProblem[] {
  if (!status || !factoryLive(status)) {
    return [];
  }
  const problems: FactoryProblem[] = [];
  if (status.phase === "ready" && status.responsive === false) {
    problems.push({ key: "heartbeat", text: "The factory does not write its heartbeat." });
  }
  for (const item of (status.attention ?? []) as unknown[]) {
    if (Array.isArray(item) && typeof item[0] === "string" && typeof item[1]?.text === "string") {
      const story = typeof item[1].storyId === "string" ? `${item[1].storyId}: ` : "";
      problems.push({ key: `attention:${item[0]}`, text: `${story}${item[1].text}` });
    } else if (item && typeof item === "object" && "file" in item && "message" in item) {
      const issue = item as { file: unknown; message: unknown };
      problems.push({ key: `issue:${String(issue.file)}`, text: `${String(issue.file)}: ${String(issue.message)}` });
    }
  }
  for (const [provider, pause] of Object.entries(status.providers ?? {})) {
    const until = pause.retryAt ? ` until ${formatDateTime(pause.retryAt)}` : "";
    problems.push({ key: `provider:${provider}`, text: `Provider ${provider} is paused (${pause.reason})${until}.` });
  }
  return problems;
}

/** The reason why the factory has not started a worker for a queued Story, in words for people. */
export function queueReason(entry: FactoryQueueEntry): string {
  const at = entry.retryAt ? ` until ${formatDateTime(entry.retryAt)}` : "";
  if (entry.action !== "skip") {
    return "waiting for the supervisor";
  }
  if (entry.reason === "worker limit") {
    return "waiting for a worker slot";
  }
  if (entry.reason === "launch delay" || entry.reason === "retry delay") {
    return `waiting${at} (${entry.reason})`;
  }
  return `${entry.reason}${at}`;
}

/** The queue entry of the Story `storyId` while a factory runs. */
export function queueEntry(status: FactoryStatus | undefined, storyId: string): FactoryQueueEntry | undefined {
  return factoryLive(status) ? status?.queue?.find((entry) => entry.story === storyId) : undefined;
}
