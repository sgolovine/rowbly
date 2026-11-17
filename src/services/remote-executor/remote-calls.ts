// The request and upload calls of a remote launch: the attachment cache, the run paths, the prepare step, the start of
// the host agent and the commands of the agent. Each call runs one fixed `rowbly host` command over the transport.

import { randomUUID } from "node:crypto";
import type { HostReceipt } from "../host-agent/host-agent-control.js";
import type { HostRunPaths } from "../host-agent/host-agent-paths.js";
import type { HostPrepareInput, HostPrepareResult } from "../host-agent/host-agent-prepare.js";
import type { HostRunState } from "../host-agent/host-run-state.js";
import { HostProtocolError } from "../host-transport/host-errors.js";
import type { HostVersions, RemoteCommand } from "../host-transport/host-transport.js";
import type { HostConnection } from "./remote-types.js";

/** The host and the project id of the calls. */
export interface CallTarget {
  readonly connection: HostConnection;
  readonly projectId: string;
}

/** The kinds of command that the executor sends to the host agent. */
export type CommandType = "launch" | "resume" | "stop-thread" | "cancel-thread";

/** The time limit of the prepare call, because its input can be large. */
const PREPARE_TIMEOUT_MS = 120_000;

/** The time limit of `host serve --detach`. The host waits up to 15 seconds for the agent. */
const SERVE_TIMEOUT_MS = 30_000;

function command(target: CallTarget, name: string, ...extra: string[]): RemoteCommand {
  return [target.connection.rowbly, "host", name, target.projectId, ...extra];
}

/** Makes the error of a remote command that exited with a code other than 0. */
function remoteFailure(name: string, exitCode: number, stderr: string): HostProtocolError {
  const text = stderr.trim();

  return new HostProtocolError(`The host command \`rowbly host ${name}\` failed with exit code ${exitCode}: ${text}`, {
    details: { exitCode, stderr: text },
  });
}

/** Runs a request call and gives its JSON value. A remote exit code other than 0 gives a HostProtocolError. */
async function request<T>(target: CallTarget, tokens: RemoteCommand, input: unknown, timeoutMs?: number): Promise<T> {
  const options = timeoutMs === undefined ? undefined : { timeoutMs };
  const result = await target.connection.transport.request(tokens, input, options);

  if (result.exitCode !== 0) {
    throw remoteFailure(tokens[2] ?? "", result.exitCode, result.stderr);
  }

  return result.value as T;
}

/** Gives the attachment ids that are not in the cache of the host. */
export async function cacheMissing(target: CallTarget, ids: readonly string[]): Promise<readonly string[]> {
  if (ids.length === 0) {
    return [];
  }

  const answer = await request<{ missing?: unknown }>(target, command(target, "cache-missing"), { ids });

  if (!Array.isArray(answer?.missing)) {
    throw new HostProtocolError("The answer of `rowbly host cache-missing` has no list of ids");
  }

  return answer.missing.filter((id): id is string => typeof id === "string");
}

/** Uploads the bytes of one attachment file to the cache of the host. */
export async function cachePut(target: CallTarget, id: string, bytes: Uint8Array): Promise<void> {
  const tokens = command(target, "cache-put", id);
  const result = await target.connection.transport.upload(tokens, Buffer.from(bytes));

  if (result.exitCode !== 0) {
    throw remoteFailure("cache-put", result.exitCode, result.stderr);
  }
}

/** Gives the absolute paths of the run on the host: the copy, the worktree, the shim and the lock. */
export async function runPaths(target: CallTarget, threadId: string, storyId: string): Promise<HostRunPaths> {
  const input = { threadId, storyId, clone: target.connection.clone };
  const answer = await request<HostRunPaths | null>(target, command(target, "run-paths"), input);

  if (!answer || [answer.copy, answer.worktree, answer.shim, answer.lock].some((path) => typeof path !== "string")) {
    throw new HostProtocolError("The answer of `rowbly host run-paths` has no paths");
  }

  return answer;
}

/** Writes the copy and the launch data of the Thread on the host. */
export function prepare(target: CallTarget, input: HostPrepareInput): Promise<HostPrepareResult> {
  return request<HostPrepareResult>(target, command(target, "prepare"), input, PREPARE_TIMEOUT_MS);
}

/** Starts the host agent of the Project, unless a live agent runs. */
export async function serve(target: CallTarget, maxWorkers: number): Promise<void> {
  const tokens = [target.connection.rowbly, "host", "serve", "--detach"];

  await request(target, tokens, { projectId: target.projectId, maxWorkers }, SERVE_TIMEOUT_MS);
}

/** Makes a new request id for a command. */
export function newCommandId(): string {
  return randomUUID();
}

/** Submits one command to the host agent, and gives its receipt or null. */
export function submit(
  target: CallTarget,
  type: CommandType,
  threadId: string,
  id: string = newCommandId(),
): Promise<HostReceipt | null> {
  return request<HostReceipt | null>(target, command(target, "submit"), { version: 1, id, type, threadId });
}

/** Asks the host for its versions, without a start of the host agent. A remote failure gives a HostProtocolError. */
export async function ping(target: CallTarget, timeoutMs: number): Promise<HostVersions> {
  const answer = await request<Partial<HostVersions> | null>(target, command(target, "ping"), {}, timeoutMs);

  if (typeof answer?.protocol !== "number" || typeof answer.rowbly !== "string") {
    throw new HostProtocolError("The answer of `rowbly host ping` has no versions");
  }

  return { protocol: answer.protocol, rowbly: answer.rowbly };
}

/** Gives the run state of each requested Thread that has one on the host. */
export async function runStates(target: CallTarget, threadIds: readonly string[]): Promise<readonly HostRunState[]> {
  const answer = await request<{ runs?: unknown } | null>(target, command(target, "runs"), { threadIds });

  if (!Array.isArray(answer?.runs)) {
    throw new HostProtocolError("The answer of `rowbly host runs` has no list of runs");
  }

  return answer.runs.filter(
    (run): run is HostRunState => typeof run?.threadId === "string" && typeof run.requestId === "string",
  );
}

/**
 * True when a call failed in the transport, so that the host can have the command or not. A command that the host
 * ran and refused gives a HostProtocolError.
 */
export function isTransportError(error: unknown): boolean {
  return !(error instanceof HostProtocolError);
}
