import { describe, expect, it } from "vitest";
import { HostAuthFailedError, HostUnreachableError, HostVersionMismatchError } from "../host-transport/host-errors.js";
import { createScriptedHost } from "../test-project/scripted-host.js";
import {
  DEFAULT_HEARTBEAT_LIMITS,
  type HostHealth,
  nextHostState,
  type PingOutcome,
  pingHost,
} from "./remote-heartbeat.js";

const LOCAL = { protocol: 2, rowbly: "1.0.0" };
const AT = "2026-01-01T00:00:00.000Z";
const answered = (latencyMs = 10, versions = LOCAL): PingOutcome => ({ kind: "answered", at: AT, latencyMs, versions });
const failed = (error: unknown = new HostUnreachableError("Cannot reach mini")): PingOutcome => ({
  kind: "failed",
  error,
});
const next = (previous: HostHealth | undefined, outcome: PingOutcome) =>
  nextHostState(previous, outcome, DEFAULT_HEARTBEAT_LIMITS, LOCAL);

describe("nextHostState", () => {
  it("is connected after a good heartbeat, with the time and the latency", () => {
    expect(next(undefined, answered())).toEqual({ state: "connected", failures: 0, lastSeenAt: AT, latencyMs: 10 });
    expect(next({ state: "disconnected", failures: 5 }, answered()).state).toBe("connected");
  });

  it("is degraded after one or two failed heartbeats in a row, and disconnected after three", () => {
    const one = next({ state: "connected", failures: 0, lastSeenAt: AT, latencyMs: 10 }, failed());
    const two = next(one, failed());
    const three = next(two, failed());

    expect(one).toEqual({ state: "degraded", failures: 1, lastSeenAt: AT, latencyMs: 10 });
    expect(two).toMatchObject({ state: "degraded", failures: 2 });
    expect(three).toMatchObject({ state: "disconnected", failures: 3, lastSeenAt: AT });
    expect(next(three, failed()).state).toBe("disconnected");
    expect(next(undefined, failed()).state).toBe("degraded");
  });

  it("is degraded for a latency above the limit", () => {
    expect(next(undefined, answered(5001))).toMatchObject({ state: "degraded", failures: 0, latencyMs: 5001 });
    expect(next(undefined, answered(5000)).state).toBe("connected");
  });

  it("is version-mismatch for a HostVersionMismatchError or a different version", () => {
    expect(next(undefined, failed(new HostVersionMismatchError("old")))).toMatchObject({ state: "version-mismatch" });
    expect(next(undefined, answered(10, { protocol: 1, rowbly: "1.0.0" })).state).toBe("version-mismatch");
    expect(next(undefined, answered(10, { protocol: 2, rowbly: "0.9.0" })).state).toBe("version-mismatch");
  });

  it("is auth-failed for a HostAuthFailedError", () => {
    expect(next(undefined, failed(new HostAuthFailedError("denied")))).toMatchObject({ state: "auth-failed" });
  });
});

describe("pingHost", () => {
  it("measures the latency with the injected clock, and never throws", async () => {
    const host = createScriptedHost({ versions: LOCAL });
    const target = { connection: { transport: host.transport, rowbly: "/opt/rowbly", clone: "repo" }, projectId: "p1" };
    const times = [1000, 1250];
    const now = () => times.shift() ?? 0;

    expect(await pingHost(target, 1000, now)).toEqual({
      kind: "answered",
      at: new Date(1250).toISOString(),
      latencyMs: 250,
      versions: LOCAL,
    });
    expect(host.requests.at(-1)?.command).toEqual(["/opt/rowbly", "host", "ping", "p1"]);

    host.transport.disconnect();
    expect(await pingHost(target, 1000, () => 0)).toEqual({
      kind: "failed",
      error: expect.objectContaining({ code: "HOST_UNREACHABLE" }),
    });
  });
});
