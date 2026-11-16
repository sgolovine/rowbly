import { describe, expect, it, vi } from "vitest";
import { Store } from "../store/store.js";
import { createScriptedHost } from "../test-project/scripted-host.js";
import { beatHosts } from "./host-heartbeat.js";
import type { Manager, ManagerState } from "./manager-state.js";

function fakeManager(transport: ReturnType<typeof createScriptedHost>["transport"]) {
  const reconnect = vi.fn(async () => undefined);
  const state = {
    stopping: false,
    hosts: [
      { id: "mini", maxWorkers: 1, state: "connected" },
      { id: "off", maxWorkers: 1, state: "not-ready" },
    ],
    hostHealth: new Map(),
  } as unknown as ManagerState;
  const manager = {
    deps: {
      hostConnection: async () => ({ transport, rowbly: "/opt/rowbly", clone: "repo" }),
      hostHeartbeat: { now: () => 0 },
    },
    paths: { root: "/project" },
    remote: { reconnect },
    store: new Store(state),
  } as unknown as Manager;
  return { manager, reconnect };
}

describe("beatHosts", () => {
  it("records the heartbeat state of each listed connected host, and reconnects only a connected host", async () => {
    const host = createScriptedHost();
    const f = fakeManager(host.transport);

    await beatHosts(f.manager);
    expect(f.manager.store.current.hostHealth.get("mini")).toMatchObject({ state: "connected", failures: 0 });
    expect(f.manager.store.current.hostHealth.has("off")).toBe(false);
    expect(f.reconnect).toHaveBeenCalledWith("mini");
    expect(host.requests.filter((request) => request.command[2] === "ping")).toHaveLength(1);

    host.transport.disconnect();
    await beatHosts(f.manager);
    await beatHosts(f.manager);
    await beatHosts(f.manager);
    expect(f.manager.store.current.hostHealth.get("mini")).toMatchObject({ state: "disconnected", failures: 3 });
    expect(f.reconnect).toHaveBeenCalledTimes(1);
    expect(f.manager.store.current.heartbeatTask).toBeUndefined();
  });
});
