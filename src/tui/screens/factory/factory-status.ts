import type { FactoryQueueEntry, FactoryStatus } from "../../../services/factory/factory.js";
import { formatDateTime } from "../../theme.js";

/** One item that asks for the attention of a person. */
export interface FactoryProblem {
  readonly key: string;
  readonly text: string;
}

type ProviderPauses = NonNullable<FactoryStatus["providers"]>;

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

  return [
    ...heartbeatProblems(status),
    ...((status.attention ?? []) as unknown[]).flatMap(attentionProblem),
    ...providerProblems(status.providers ?? {}),
  ];
}

/** A ready factory that does not write its heartbeat. */
function heartbeatProblems(status: FactoryStatus): FactoryProblem[] {
  return status.phase === "ready" && status.responsive === false
    ? [{ key: "heartbeat", text: "The factory does not write its heartbeat." }]
    : [];
}

/** One attention item: a `[key, { text, storyId? }]` pair or a `{ file, message }` issue. Other shapes give none. */
function attentionProblem(item: unknown): FactoryProblem[] {
  if (Array.isArray(item) && typeof item[0] === "string" && typeof item[1]?.text === "string") {
    const story = typeof item[1].storyId === "string" ? `${item[1].storyId}: ` : "";

    return [{ key: `attention:${item[0]}`, text: `${story}${item[1].text}` }];
  }

  if (item && typeof item === "object" && "file" in item && "message" in item) {
    const issue = item as { file: unknown; message: unknown };

    return [{ key: `issue:${String(issue.file)}`, text: `${String(issue.file)}: ${String(issue.message)}` }];
  }

  return [];
}

/** The providers that the factory paused, with the time of the next try. */
function providerProblems(providers: ProviderPauses): FactoryProblem[] {
  return Object.entries(providers).map(([provider, pause]) => {
    const until = pause.retryAt ? ` until ${formatDateTime(pause.retryAt)}` : "";

    return { key: `provider:${provider}`, text: `Provider ${provider} is paused (${pause.reason})${until}.` };
  });
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
