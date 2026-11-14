import type { FactoryStatus } from "../../../services/factory/factory.js";
import type { ThreadRecord } from "../../../services/thread/thread.js";
import type { KeyHint } from "../../keymap.js";

type ThreadModel = ThreadRecord["model"];

type Workers = FactoryStatus["workers"];

/** The words of a phase for people. */
export const PHASES: Readonly<Record<FactoryStatus["phase"], string>> = {
  starting: "Starting",
  ready: "Running",
  stopping: "Stopping",
  stopped: "Stopped",
  failed: "Failed",
  unavailable: "Unavailable",
};

/** The keys that the Factory controls offer now. */
export function factoryHints(can: {
  readonly start: boolean;
  readonly stop: boolean;
  readonly inspect: boolean;
  readonly warnings: boolean;
  readonly aiSettings: boolean;
}): KeyHint[] {
  return [
    ...(can.start ? [{ key: "s", description: "start" }] : []),
    ...(can.stop ? [{ key: "x", description: "stop" }] : []),
    ...(can.inspect ? [{ key: "enter", description: "supervisor" }] : []),
    ...(can.warnings ? [{ key: "w", description: "warnings" }] : []),
    { key: "h", description: "history" },
    ...(can.aiSettings ? [{ key: "a", description: "AI settings" }] : []),
    { key: "esc", description: "back" },
  ];
}

/** The keys of the list of the warnings. */
export const ATTENTION_HINTS: readonly KeyHint[] = [
  { key: "↑/↓", description: "select" },
  { key: "enter", description: "open" },
  { key: "/", description: "filter" },
  { key: "esc", description: "back" },
];

/** The keys of the detail view of a warning that it offers now. */
export function problemHints(can: {
  readonly story: boolean;
  readonly thread: boolean;
  readonly dismiss: boolean;
}): KeyHint[] {
  return [
    ...(can.story ? [{ key: "o", description: "open Story" }] : []),
    ...(can.thread ? [{ key: "t", description: "open Thread" }] : []),
    ...(can.dismiss ? [{ key: "d", description: "dismiss" }] : []),
    { key: "esc", description: "back" },
  ];
}

/** The model of the supervisor. A live factory without a choice uses the Pi default. */
export function supervisorText(model: ThreadModel, live: boolean): string {
  if (model) {
    return `${model.provider}/${model.modelId}`;
  }

  return live ? "Pi default" : "—";
}

/** The worker counts of a live factory, or only the limit when the factory is off. */
export function workersText(live: boolean, workers: Workers, limit: number | undefined): string {
  if (live && workers) {
    return `${workers.running} running · ${workers.pending} pending · limit ${workers.limit}`;
  }

  return limit !== undefined ? `limit ${limit}` : "—";
}

/** The model of a supervisor Thread in the history list. */
export function historyModel(thread: ThreadRecord): string {
  return thread.model ? `${thread.model.provider}/${thread.model.modelId}` : "Pi default";
}

/** Tells the person how to sign in: in the TUI when it has the AI settings, or else with the CLI. */
export function providerNotice(aiSettings: boolean): string {
  return aiSettings
    ? "No AI provider is signed in. Press a to sign in before you start the factory."
    : "No AI provider is signed in. Sign in with rowbly auth login before you start the factory.";
}
