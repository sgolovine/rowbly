import type { FactoryQueueEntry, FactoryStatus } from "../../../services/factory/factory.js";
import { CRASH_LIMIT_KEY } from "../../../services/factory-watchdog/factory-watchdog.js";
import { formatDateTime } from "../../theme.js";

/** Where a factory problem comes from. Only an `attention` entry of the manager can be dismissed. */
export type FactoryProblemKind = "heartbeat" | "attention" | "issue" | "provider" | "watchdog";

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

/** The connectivity of a live factory when it is `offline` or `degraded`, else undefined. */
export function connectivityWord(status: FactoryStatus | undefined): "offline" | "degraded" | undefined {
  const connectivity = factoryLive(status) ? status?.connectivity : undefined;

  return connectivity === "offline" || connectivity === "degraded" ? connectivity : undefined;
}

/**
 * The short state of the factory for the header: `off`, `starting`, `2/4 · 1 pending` and the other phases.
 * A live, ready factory with the connectivity `offline` or `degraded` shows that word in place of the worker counts.
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

  const connectivity = connectivityWord(status);

  if (connectivity) {
    return connectivity;
  }

  const { running, pending, limit } = status.workers;

  return pending > 0 && !short ? `${running}/${limit} · ${pending} pending` : `${running}/${limit}`;
}

/**
 * The problems of a factory that runs: its attention items, the providers that it paused and a heartbeat that
 * stopped. A stopped factory has no problems, because its status file is old. Only a factory that failed at the
 * crash limit of its watchdog has the crash-limit problem.
 */
export function factoryProblems(status: FactoryStatus | undefined): FactoryProblem[] {
  if (!status) {
    return [];
  }

  if (!factoryLive(status)) {
    return status.phase === "failed" ? ((status.attention ?? []) as unknown[]).flatMap(crashLimitProblem) : [];
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

/** The crash-limit entry of the watchdog. Only the next start clears it, so it cannot be dismissed. */
function crashLimitProblem(item: unknown): FactoryProblem[] {
  if (!Array.isArray(item) || item[0] !== CRASH_LIMIT_KEY || typeof item[1]?.text !== "string") {
    return [];
  }

  const message: string = item[1].text;

  return [
    {
      key: `attention:${CRASH_LIMIT_KEY}`,
      kind: "watchdog",
      title: "Crash limit",
      text: message,
      message,
      attentionKey: CRASH_LIMIT_KEY,
      dismissible: false,
    },
  ];
}

/** The restart count and the time of the last crash, for example `2 · last crash 12 May 10:02`. */
export function restartText(status: FactoryStatus | undefined): string | undefined {
  if (!status?.restarts && !status?.lastCrashAt) {
    return undefined;
  }

  const crash = status.lastCrashAt ? ` · last crash ${formatDateTime(status.lastCrashAt)}` : "";

  return `${status.restarts ?? 0}${crash}`;
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

/** The network pause of the provider of the worker model of the queued Story, or undefined. */
function networkPause(entry: FactoryQueueEntry, providers: ProviderPauses | undefined) {
  const pause = entry.provider ? providers?.[entry.provider] : undefined;

  return pause?.reason === "network" ? pause : undefined;
}

/**
 * The reason why the factory has not started a worker for a queued Story, in words for people. When the provider of
 * its worker model has a network pause in `providers`, the Story waits for the network.
 */
export function queueReason(entry: FactoryQueueEntry, providers?: ProviderPauses): string {
  const at = entry.retryAt ? ` until ${formatDateTime(entry.retryAt)}` : "";
  const network = networkPause(entry, providers);

  if (network) {
    return `waiting for the network${network.retryAt ? ` until ${formatDateTime(network.retryAt)}` : ""}`;
  }

  if (entry.action !== "skip") {
    return "waiting for a worker start";
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
