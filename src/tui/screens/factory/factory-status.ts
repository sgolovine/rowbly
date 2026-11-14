import type { FactoryQueueEntry, FactoryStatus } from "../../../services/factory/factory.js";
import { formatDateTime } from "../../theme.js";

/** Where a factory problem comes from. Only an `attention` entry of the manager can be dismissed. */
export type FactoryProblemKind = "heartbeat" | "attention" | "issue" | "provider";

/** One item that asks for the attention of a person. */
export interface FactoryProblem {
  /** A key that is unique in the list, for example `attention:commit`. */
  readonly key: string;
  readonly kind: FactoryProblemKind;
  /** A short name for the breadcrumb of the detail view. */
  readonly title: string;
  /** One line for the list: the message with the Story ID or the file in front of it. */
  readonly text: string;
  /** The full message, without the Story ID or the file. */
  readonly message: string;
  /** The key of the attention entry in the manager state. */
  readonly attentionKey?: string;
  readonly storyId?: string;
  /** The Thread file of an `issue`. */
  readonly file?: string;
  /** True for an attention entry, which the daemon can remove. */
  readonly dismissible: boolean;
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

const HEARTBEAT_TEXT = "The factory does not write its heartbeat.";

/** A ready factory that does not write its heartbeat. */
function heartbeatProblems(status: FactoryStatus): FactoryProblem[] {
  return status.phase === "ready" && status.responsive === false
    ? [
        {
          key: "heartbeat",
          kind: "heartbeat",
          title: "Heartbeat",
          text: HEARTBEAT_TEXT,
          message: HEARTBEAT_TEXT,
          dismissible: false,
        },
      ]
    : [];
}

/** One attention item: a `[key, { text, storyId? }]` pair or a `{ file, message }` issue. Other shapes give none. */
function attentionProblem(item: unknown): FactoryProblem[] {
  if (Array.isArray(item) && typeof item[0] === "string" && typeof item[1]?.text === "string") {
    return [attentionEntry(item[0], item[1].text, item[1].storyId)];
  }

  if (item && typeof item === "object" && "file" in item && "message" in item) {
    const issue = item as { file: unknown; message: unknown };

    return [threadIssue(String(issue.file), String(issue.message))];
  }

  return [];
}

/** An entry that the manager recorded with `key`. It can name the Story that it is about. */
function attentionEntry(key: string, message: string, storyId: unknown): FactoryProblem {
  const story = typeof storyId === "string" ? storyId : undefined;

  return {
    key: `attention:${key}`,
    kind: "attention",
    title: key,
    text: story ? `${story}: ${message}` : message,
    message,
    attentionKey: key,
    storyId: story,
    dismissible: true,
  };
}

/** A Thread file that the factory cannot read. */
function threadIssue(file: string, message: string): FactoryProblem {
  return {
    key: `issue:${file}`,
    kind: "issue",
    title: "Thread file",
    text: `${file}: ${message}`,
    message,
    file,
    dismissible: false,
  };
}

/** The providers that the factory paused, with the time of the next try. */
function providerProblems(providers: ProviderPauses): FactoryProblem[] {
  return Object.entries(providers).map(([provider, pause]) => {
    const until = pause.retryAt ? ` until ${formatDateTime(pause.retryAt)}` : "";

    const text = `Provider ${provider} is paused (${pause.reason})${until}.`;

    return {
      key: `provider:${provider}`,
      kind: "provider",
      title: `Provider ${provider}`,
      text,
      message: text,
      dismissible: false,
    };
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
