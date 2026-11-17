import { describe, expect, it, vi } from "vitest";
import type { WorkerEvents } from "../factory-manager/worker-executor.js";
import { Store } from "../store/store.js";
import { createScriptedHost } from "../test-project/scripted-host.js";
import type { ThreadRecord } from "../thread/thread.js";
import { closeIdleLink, ensureLink, hostRuns, linkOpen } from "./remote-channel.js";
import { newRemoteRun } from "./remote-run.js";
import type { RemoteEnv, RemoteState } from "./remote-types.js";

const events = { failed: vi.fn(async () => undefined) } as unknown as WorkerEvents;

function env(): RemoteEnv {
  return {
    input: { projectId: "p1" } as RemoteEnv["input"],
    state: new Store<RemoteState>({
      runs: new Map(),
      links: new Map(),
      queueChain: Promise.resolve(),
      reconnects: new Map(),
      outcomes: new Map(),
    }),
  };
}

describe("remote channel", () => {
  it("opens one channel for each host, gives each frame to its run, and closes an idle channel", async () => {
    const host = createScriptedHost();
    const e = env();
    const run = newRemoteRun({ id: "t1" } as ThreadRecord, "mini", events);
    run.store.update(() => ({ commandId: "c1" }));
    e.state.update(() => ({ runs: new Map([["t1", run]]) }));
    const connection = { transport: host.transport, rowbly: "/r/rowbly", clone: "repo" };
    const hooks = { sync: async () => undefined, stopHost: async () => undefined };

    await ensureLink(e, "mini", connection, hooks);
    await ensureLink(e, "mini", connection, hooks);
    expect(host.transport.openChannels).toBe(1);
    expect(linkOpen(e, "mini")).toBe(true);
    expect(hostRuns(e, "mini")).toEqual([run]);

    host.send({ type: "receipt", receipt: { version: 1, id: "other", ownerToken: "o", status: "rejected" } });
    host.send({ type: "receipt", receipt: { version: 1, id: "c1", ownerToken: "o", status: "rejected" } });
    await vi.waitFor(() => expect(events.failed).toHaveBeenCalledTimes(1));

    closeIdleLink(e, "mini");
    expect(linkOpen(e, "mini")).toBe(true);
    e.state.update(() => ({ runs: new Map() }));
    closeIdleLink(e, "mini");
    expect(linkOpen(e, "mini")).toBe(false);
    await vi.waitFor(() => expect(host.transport.openChannels).toBe(0));
  });

  it("records a channel that the host closes, so that a later launch opens a new one", async () => {
    const host = createScriptedHost();
    const e = env();
    const connection = { transport: host.transport, rowbly: "/r/rowbly", clone: "repo" };
    const hooks = { sync: async () => undefined, stopHost: async () => undefined };

    await ensureLink(e, "mini", connection, hooks);
    host.closeChannels();
    await vi.waitFor(() => expect(linkOpen(e, "mini")).toBe(false));

    await ensureLink(e, "mini", connection, hooks);
    expect(linkOpen(e, "mini")).toBe(true);
  });
});
