import { describe, expect, it } from "vitest";
import { countByHost, hostSlots, placementCapacity, withHeartbeatStates } from "./host-slots.js";

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
