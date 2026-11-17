import { RowblyError } from "../errors/errors.js";
import type { ModelChoice } from "../factory-settings/factory-settings.js";
import type { LocalBuild } from "../host-install/local-build.js";
import type { BytesResult, HostTransport, RemoteCommand } from "../host-transport/host-transport.js";

/** The IDs of the check items, in the order of the check. */
export const CHECK_ITEM_IDS = [
  "ssh",
  "linux",
  "flock",
  "git",
  "node",
  "rowbly",
  "pi-login",
  "models",
  "clone",
  "git-push",
  "gh",
  "git-identity",
  "local-ahead",
] as const;

export type CheckItemId = (typeof CHECK_ITEM_IDS)[number];

/** The result of one item. Only `fail` makes the host not ready. */
export type CheckState = "ok" | "warning" | "fail" | "skipped";

/** One line of the checklist of a worker host. */
export interface CheckItem {
  readonly id: CheckItemId;
  readonly label: string;
  readonly state: CheckState;
  readonly detail: string;
  /** What the user must do on the host. Each `fail` item has an action. */
  readonly action?: string;
}

/** The facts of the current Project that the check uses. Outside a Project, the check has no facts. */
export interface ProjectFacts {
  /** The local Project root. */
  readonly root: string;
  /** The worker models of the factory settings, without duplicates. */
  readonly models: readonly ModelChoice[];
}

/**
 * Finds the clone of the Project on the host. It gives the path of the clone, or `undefined` when the host has no
 * clone. `hostCloneFinder` uses the records of `rowbly host use`.
 */
export type CloneFinder = (transport: HostTransport, hostId: string, root: string) => Promise<string | undefined>;

/** The environment of each item of one check. */
export interface CheckEnv {
  readonly hostId: string;
  readonly transport: HostTransport;
  readonly build: LocalBuild;
  readonly project: ProjectFacts | undefined;
}

/** The result of one remote command: the output, or the transport error of the call. */
export type RemoteOutcome =
  | { readonly ok: true; readonly result: BytesResult }
  | { readonly ok: false; readonly error: RowblyError };

/** The output limit of a check command. Each command prints a short text. */
const CHECK_OUTPUT_LIMIT = 64 * 1024;

/** The labels of the items. */
export const LABELS: Readonly<Record<CheckItemId, string>> = {
  ssh: "SSH without a password",
  linux: "Linux",
  flock: "flock",
  git: "Git",
  node: "Node 22.19 or later",
  rowbly: "Rowbly version",
  "pi-login": "Pi login",
  models: "Worker models",
  clone: "Clone of the Project",
  "git-push": "Git push access",
  gh: "GitHub CLI login",
  "git-identity": "Git identity",
  "local-ahead": "Local commits on origin",
};

/** Makes an item with the label of its ID. */
export function item(id: CheckItemId, state: CheckState, detail: string, action?: string): CheckItem {
  return action === undefined
    ? { id, label: LABELS[id], state, detail }
    : { id, label: LABELS[id], state, detail, action };
}

/** Runs a remote command. A transport error is the result, not a throw. Any other error is a bug and throws. */
export async function runRemote(env: CheckEnv, command: RemoteCommand): Promise<RemoteOutcome> {
  try {
    return { ok: true, result: await env.transport.bytes(command, null, { limit: CHECK_OUTPUT_LIMIT }) };
  } catch (error) {
    if (!(error instanceof RowblyError)) {
      throw error;
    }

    return { ok: false, error };
  }
}

/** The text of the stdout of a result, without the space at the ends. */
export function stdoutText(result: BytesResult): string {
  return result.bytes.toString("utf8").trim();
}

/** The first line of a text, or the fallback for an empty text. */
export function firstLine(text: string, fallback: string): string {
  const line = text.trim().split("\n")[0]?.trim() ?? "";

  return line === "" ? fallback : line;
}

/** The detail of a failed command: the first line of stderr, else the exit code. */
export function failureText(result: BytesResult): string {
  return firstLine(result.stderr, `exited with code ${result.exitCode}`);
}

/** The `fail` item for a transport error during a later item. */
export function transportFailure(env: CheckEnv, id: CheckItemId, error: RowblyError): CheckItem {
  return item(
    id,
    "fail",
    `${error.code}: ${error.message}`,
    error.hint ?? `Make sure that the SSH connection works, then run rowbly host check ${env.hostId} again.`,
  );
}

/** A `skipped` item. */
export function skipped(id: CheckItemId, reason: string, action?: string): CheckItem {
  return item(id, "skipped", reason, action);
}
