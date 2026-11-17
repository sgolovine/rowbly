import { readFile } from "node:fs/promises";
import { describe, expect, it, vi } from "vitest";
import { runtimePath } from "../runtime-files/runtime-files.js";
import { Store } from "../store/store.js";
import { createScriptedHost } from "../test-project/scripted-host.js";
import { useTestProject } from "../test-project/test-project.js";
import { beatHosts, hostAttentionText, withHostAttention } from "./host-heartbeat.js";
import type { Manager, ManagerState } from "./manager-state.js";
import { persistStatus } from "./manager-status.js";

function fakeManager(transport: ReturnType<typeof createScriptedHost>["transport"]) {
  const reconnect = vi.fn(async () => undefined);
  const state = {
    stopping: false,
    hosts: [
      { id: "mini", maxWorkers: 1, state: "connected" },
      { id: "off", maxWorkers: 1, state: "not-ready" },
    ],
    hostHealth: new Map(),
    attention: new Map(),
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

describe("host attention", () => {
  it("sets the entry for a lost state and removes it for a state that answers", () => {
    const keep = new Map([["other", { text: "keep" }]]);
    const seen = "2026-11-16T10:00:00.000Z";

    for (const state of ["disconnected", "version-mismatch", "auth-failed"] as const) {
      const attention = withHostAttention(keep, "mini", { state, failures: 3, lastSeenAt: seen });
      expect(attention.get("host:mini")).toEqual({ text: `Worker host mini is ${state}. Last contact: ${seen}.` });
      expect(attention.get("other")).toEqual({ text: "keep" });
      for (const good of ["connected", "degraded"] as const) {
        expect(withHostAttention(attention, "mini", { state: good, failures: 0 }).has("host:mini")).toBe(false);
      }
    }
    expect(hostAttentionText("mini", { state: "auth-failed", failures: 1 })).toBe(
      "Worker host mini is auth-failed. Last contact: never.",
    );
  });
});

describe("host attention in the status file", () => {
  const project = useTestProject();

  function statusManager(transport: ReturnType<typeof createScriptedHost>["transport"]): Manager {
    const state = {
      queue: Promise.resolve(),
      phase: "ready",
      revision: 0,
      stopping: false,
      settings: {},
      limit: 1,
      hosts: [{ id: "mini", maxWorkers: 1, state: "connected" }],
      hostHealth: new Map(),
      active: new Map(),
      hostSync: new Set(),
      holds: new Map(),
      attention: new Map(),
      providers: new Map(),
      networkFailures: new Map(),
      deliveredReportIds: [],
      nextWakeAt: 0,
      unanswered: 0,
    } as unknown as ManagerState;
    return {
      deps: {
        hostConnection: async () => ({ transport, rowbly: "/opt/rowbly", clone: "repo" }),
        hostHeartbeat: { now: () => Date.parse("2026-11-16T10:00:00.000Z") },
      },
      paths: project.paths,
      ctx: project.ctx,
      owner: { token: "t" },
      remote: { reconnect: async () => undefined },
      store: new Store(state),
    } as unknown as Manager;
  }

  async function storedStatus() {
    return JSON.parse(await readFile(await runtimePath(project.paths, "status.json"), "utf8"));
  }

  it("writes the entry after the host is disconnected and removes it after a good heartbeat", async () => {
    const host = createScriptedHost();
    const manager = statusManager(host.transport);

    await beatHosts(manager);
    await persistStatus(manager);
    const first = await storedStatus();
    expect(first.attention.map(([key]: [string]) => key)).not.toContain("host:mini");
    expect(first.hosts[1]).toMatchObject({ id: "mini", state: "connected", max: 1, used: 0, free: 1 });
    expect(typeof first.hosts[1].lastSeenAt).toBe("string");
    expect(typeof first.hosts[1].latencyMs).toBe("number");
    expect(first.hosts[0]).toEqual({ id: "local", state: "connected", max: 1, used: 0, free: 1 });

    host.transport.disconnect();
    await beatHosts(manager);
    await beatHosts(manager);
    await beatHosts(manager);
    await persistStatus(manager);
    const lost = await storedStatus();
    expect(lost.hosts[1]).toMatchObject({ id: "mini", state: "disconnected", lastSeenAt: first.hosts[1].lastSeenAt });
    expect(lost.attention).toContainEqual([
      "host:mini",
      { text: `Worker host mini is disconnected. Last contact: ${first.hosts[1].lastSeenAt}.` },
    ]);

    host.transport.reconnect();
    await beatHosts(manager);
    await persistStatus(manager);
    const back = await storedStatus();
    expect(back.hosts[1]).toMatchObject({ id: "mini", state: "connected" });
    expect(back.attention.map(([key]: [string]) => key)).not.toContain("host:mini");
  });
});
