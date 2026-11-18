// The heartbeat of a worker host: one `rowbly host ping` request, and the pure state function of its outcomes.

import type { HostState } from "../factory-manager/host-slots.js";
import { HostAuthFailedError, HostVersionMismatchError } from "../host-transport/host-errors.js";
import { checkHello } from "../host-transport/host-handshake.js";
import { type HostVersions, localVersions } from "../host-transport/host-transport.js";
import { type CallTarget, ping } from "./remote-calls.js";

/** The state of a host that the heartbeat gives. */
type HeartbeatState = Exclude<HostState, "not-ready">;

/** The limits of the heartbeat. */
export interface HeartbeatLimits {
  /** The time between two heartbeats of a host. */
  readonly intervalMs: number;
  /** The time limit of one `host ping` request. */
  readonly timeoutMs: number;
  /** A heartbeat with a larger latency makes the host `degraded`. */
  readonly latencyLimitMs: number;
  /** The number of failed heartbeats in a row that makes the host `disconnected`. */
  readonly failureLimit: number;
}

export const DEFAULT_HEARTBEAT_LIMITS: HeartbeatLimits = {
  intervalMs: 15_000,
  timeoutMs: 10_000,
  latencyLimitMs: 5000,
  failureLimit: 3,
};

/** The heartbeat facts of one host. */
export interface HostHealth {
  readonly state: HeartbeatState;
  /** The number of failed heartbeats in a row. */
  readonly failures: number;
  /** The time of the last good heartbeat, as an ISO text. */
  readonly lastSeenAt?: string;
  /** The latency of the last good heartbeat, in milliseconds. */
  readonly latencyMs?: number;
}

/** The outcome of one heartbeat. */
export type PingOutcome =
  | { readonly kind: "answered"; readonly at: string; readonly latencyMs: number; readonly versions: HostVersions }
  | { readonly kind: "failed"; readonly error: unknown };

/** True when the versions of the host are equal to the local versions. */
function sameVersions(versions: HostVersions, local: HostVersions): boolean {
  try {
    checkHello({ type: "hello", ...versions }, local);

    return true;
  } catch {
    return false;
  }
}

function answeredState(
  outcome: Extract<PingOutcome, { kind: "answered" }>,
  limits: HeartbeatLimits,
  local: HostVersions,
): HeartbeatState {
  if (!sameVersions(outcome.versions, local)) {
    return "version-mismatch";
  }

  return outcome.latencyMs > limits.latencyLimitMs ? "degraded" : "connected";
}

/** The state after a failed heartbeat: a version or an authentication error, else the count of failures in a row. */
function failedState(error: unknown, failures: number, limits: HeartbeatLimits): HeartbeatState {
  if (error instanceof HostVersionMismatchError) {
    return "version-mismatch";
  }

  if (error instanceof HostAuthFailedError) {
    return "auth-failed";
  }

  return failures >= limits.failureLimit ? "disconnected" : "degraded";
}

/**
 * Gives the heartbeat facts of a host after one outcome. `connected` after a good heartbeat; `degraded` after one or
 * two failed heartbeats in a row, or a latency above the limit; `disconnected` after three failed heartbeats in a row;
 * `version-mismatch` for a different version; `auth-failed` for an authentication error. No I/O.
 */
export function nextHostState(
  previous: HostHealth | undefined,
  outcome: PingOutcome,
  limits: HeartbeatLimits = DEFAULT_HEARTBEAT_LIMITS,
  local: HostVersions = localVersions(),
): HostHealth {
  if (outcome.kind === "answered") {
    return {
      state: answeredState(outcome, limits, local),
      failures: 0,
      lastSeenAt: outcome.at,
      latencyMs: outcome.latencyMs,
    };
  }

  const failures = (previous?.failures ?? 0) + 1;
  const kept = {
    ...(previous?.lastSeenAt ? { lastSeenAt: previous.lastSeenAt } : {}),
    ...(previous?.latencyMs === undefined ? {} : { latencyMs: previous.latencyMs }),
  };

  return { state: failedState(outcome.error, failures, limits), failures, ...kept };
}

/** Sends one heartbeat to the host. `now` gives the time in milliseconds. It never throws. */
export async function pingHost(target: CallTarget, timeoutMs: number, now: () => number): Promise<PingOutcome> {
  const start = now();

  try {
    const versions = await ping(target, timeoutMs);
    const end = now();

    return { kind: "answered", at: new Date(end).toISOString(), latencyMs: end - start, versions };
  } catch (error) {
    return { kind: "failed", error };
  }
}
