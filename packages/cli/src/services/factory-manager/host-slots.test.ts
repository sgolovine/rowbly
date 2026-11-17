import { describe, expect, it } from "vitest";
import { countByHost, hostSlots, placementCapacity, withContactFacts, withHeartbeatStates } from "./host-slots.js";

describe("hostSlots", () => {
  const hosts = [
    { id: "a", maxWorkers: 2, state: "connected" as const, providers: ["openai"] },
    { id: "b", maxWorkers: 3, state: "disconnected" as const },
  ];

  it("gives the slots of local first, then of each worker host", () => {
    expect(hostSlots(4, hosts, countByHost(["local", "a", "a", "local", "a"]))).toEqual([
      { id: "local", state: "connected", max: 4, used: 2, free: 2 },
      { id: "a", state: "connected", max: 2, used: 3, free: 0 },
      { id: "b", state: "disconnected", max: 3, used: 0, free: 3 },
    ]);
    expect(hostSlots(1, [], new Map())).toEqual([{ id: "local", state: "connected", max: 1, used: 0, free: 1 }]);
  });

  it("counts only the hosts that can take work in the capacity", () => {
    expect(placementCapacity(4, [])).toBe(4);
    expect(placementCapacity(4, hosts)).toBe(6);
  });
});

describe("withHeartbeatStates", () => {
  it("uses the heartbeat state of a listed connected host, and the list state before the first heartbeat", () => {
    const hosts = [
      { id: "a", maxWorkers: 1, state: "connected" as const },
      { id: "b", maxWorkers: 1, state: "connected" as const },
      { id: "c", maxWorkers: 1, state: "not-ready" as const },
    ];
    const heartbeat = new Map([
      ["a", { state: "degraded" as const }],
      ["c", { state: "connected" as const }],
    ]);

    expect(withHeartbeatStates(hosts, heartbeat).map((host) => [host.id, host.state])).toEqual([
      ["a", "degraded"],
      ["b", "connected"],
      ["c", "not-ready"],
    ]);
    expect(placementCapacity(1, withHeartbeatStates(hosts, heartbeat))).toBe(2);
  });
});

describe("withContactFacts", () => {
  const seen = "2026-11-16T10:00:00.000Z";

  it("adds the last contact and the latency of each worker host state, but not of local", () => {
    const states = ["connected", "degraded", "disconnected", "version-mismatch", "auth-failed", "not-ready"] as const;
    const hosts = states.map((state) => ({ id: state, maxWorkers: 2, state }));
    const heartbeat = new Map([
      ["local", { lastSeenAt: seen, latencyMs: 1 }],
      ...states.map((state): [string, { lastSeenAt: string; latencyMs: number }] => [
        state,
        { lastSeenAt: seen, latencyMs: 40 },
      ]),
    ]);

    expect(withContactFacts(hostSlots(1, hosts, countByHost(["degraded"])), heartbeat)).toEqual([
      { id: "local", state: "connected", max: 1, used: 0, free: 1 },
      ...states.map((state) => ({
        id: state,
        state,
        max: 2,
        used: state === "degraded" ? 1 : 0,
        free: state === "degraded" ? 1 : 2,
        lastSeenAt: seen,
        latencyMs: 40,
      })),
    ]);
  });

  it("gives no last contact and no latency before the first heartbeat", () => {
    const slots = withContactFacts(
      hostSlots(1, [{ id: "new", maxWorkers: 1, state: "connected" }], new Map()),
      new Map(),
    );
    const failed = withContactFacts(slots, new Map([["new", {}]]));

    expect(slots[1]).toEqual({ id: "new", state: "connected", max: 1, used: 0, free: 1 });
    expect(Object.keys(failed[1] ?? {})).toEqual(["id", "state", "max", "used", "free"]);
  });
});
