import { beforeEach, describe, expect, it, vi } from "vitest";
import { steeringMessage } from "../messages/messages.js";
import type { PiSession } from "../pi-runtime/pi-runtime.js";
import { Store } from "../store/store.js";
import type { ThreadRecord } from "../thread/thread.js";
import { sessionControl } from "./local-executor.js";
import type { Manager, ManagerState } from "./manager-state.js";
import { steerWorker } from "./worker-steer.js";

const mocks = vi.hoisted(() => ({ getThread: vi.fn() }));

vi.mock("../thread/thread.js", () => ({ getThread: mocks.getThread }));
vi.mock("../factory-ownership/factory-ownership.js", () => ({ assertFactoryOwnership: async () => {} }));

function fakeSession(isStreaming = true) {
  const steer = vi.fn(async () => "queued");
  const prompt = vi.fn(async () => {});
  const session = { session: { isStreaming, steer, prompt }, prompt } as unknown as PiSession;

  return { session, steer, prompt };
}

function active(session: PiSession) {
  return { task: Promise.resolve(), host: "local", control: sessionControl(session) };
}

function thread(patch: Partial<ThreadRecord> = {}): ThreadRecord {
  return {
    id: "thread",
    status: "running",
    runs: [{ id: "run", ownerToken: "owner" }],
    ...patch,
  } as unknown as ThreadRecord;
}

function createManager(active: ManagerState["active"]): Manager {
  const state = { queue: Promise.resolve(), active } as unknown as ManagerState;

  return {
    paths: { root: "/project" },
    ctx: {},
    owner: { token: "owner" },
    store: new Store(state),
  } as unknown as Manager;
}

describe("steerWorker", () => {
  beforeEach(() => {
    mocks.getThread.mockReset();
  });

  it("gives the steering message to the Pi session of the running worker", async () => {
    const fake = fakeSession();
    const manager = createManager(new Map([["thread", active(fake.session)]]));
    mocks.getThread.mockResolvedValue(thread());

    await steerWorker(manager, "thread", "run", "Use the new API");

    expect(fake.steer).toHaveBeenCalledExactlyOnceWith(steeringMessage("Use the new API"));
    expect(steeringMessage("Use the new API")).toContain("Use the new API");
  });

  it("rejects a different run or owner token", async () => {
    const fake = fakeSession();
    const manager = createManager(new Map([["thread", active(fake.session)]]));

    mocks.getThread.mockResolvedValue(thread());
    await expect(steerWorker(manager, "thread", "old-run", "text")).rejects.toThrow("Worker run changed");

    mocks.getThread.mockResolvedValue(thread({ runs: [{ id: "run", ownerToken: "other" }] } as never));
    await expect(steerWorker(manager, "thread", "run", "text")).rejects.toThrow("Worker run changed");
    expect(fake.steer).not.toHaveBeenCalled();
  });

  it("rejects a Thread that is not in the active map or does not run", async () => {
    const fake = fakeSession();

    mocks.getThread.mockResolvedValue(thread());
    await expect(steerWorker(createManager(new Map()), "thread", "run", "text")).rejects.toMatchObject({
      code: "CONFLICT",
      message: "Worker is not running",
    });

    const manager = createManager(new Map([["thread", active(fake.session)]]));

    mocks.getThread.mockResolvedValue(thread({ status: "pending" }));
    await expect(steerWorker(manager, "thread", "run", "text")).rejects.toThrow("Worker is not running");
    expect(fake.steer).not.toHaveBeenCalled();
  });

  it("rejects a worker without a Pi session", async () => {
    const manager = createManager(new Map([["thread", { task: Promise.resolve(), host: "local" }]]));
    mocks.getThread.mockResolvedValue(thread());

    await expect(steerWorker(manager, "thread", "run", "text")).rejects.toMatchObject({
      code: "CONFLICT",
      message: "Worker has no session",
    });
  });

  it("rejects a session that does not stream, and starts no new prompt", async () => {
    const fake = fakeSession(false);
    const manager = createManager(new Map([["thread", active(fake.session)]]));
    mocks.getThread.mockResolvedValue(thread());

    await expect(steerWorker(manager, "thread", "run", "text")).rejects.toMatchObject({
      code: "CONFLICT",
      message: "Worker is not working now",
    });
    expect(fake.steer).not.toHaveBeenCalled();
    expect(fake.prompt).not.toHaveBeenCalled();
  });
});
