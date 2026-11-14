import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { FactorySettings } from "../factory-settings/factory-settings.js";
import type { SyncResult } from "../project-sync/project-sync.js";
import { Store } from "../store/store.js";
import type { Manager, ManagerState } from "./manager-state.js";
import { isSyncDue, startProjectSync } from "./project-sync-step.js";

const mocks = vi.hoisted(() => ({
  sync: vi.fn(),
  persist: vi.fn(async () => {}),
}));

vi.mock("../project-sync/project-sync.js", () => ({ syncCanonicalProject: mocks.sync }));
vi.mock("./manager-status.js", () => ({ persistStatus: mocks.persist }));
vi.mock("../factory-ownership/factory-ownership.js", () => ({ assertFactoryOwnership: async () => {} }));

function settings(git: FactorySettings["git"]): FactorySettings {
  return { maxWorkers: 1, git };
}

function createManager(git: FactorySettings["git"]): Manager {
  const state = {
    queue: Promise.resolve(),
    stopping: false,
    settings: settings(git),
    attention: new Map(),
    lastSyncAt: 0,
  } as unknown as ManagerState;
  return { paths: { root: "/project" }, owner: { token: "t" }, store: new Store(state) } as unknown as Manager;
}

const on = { push: true, pull: true, syncIntervalSeconds: 60 };

async function finished(manager: Manager): Promise<void> {
  await manager.store.current.syncTask;
}

describe("startProjectSync", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-01T00:00:00Z"));
    mocks.sync.mockReset();
    mocks.persist.mockClear();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("runs one sync after start and then each interval", async () => {
    mocks.sync.mockResolvedValue({ pull: { status: "ok" }, push: { status: "skipped" } } satisfies SyncResult);
    const manager = createManager(on);

    startProjectSync(manager);
    await finished(manager);
    expect(mocks.sync).toHaveBeenCalledExactlyOnceWith("/project", { push: true, pull: true });

    vi.advanceTimersByTime(30_000);
    startProjectSync(manager);
    expect(mocks.sync).toHaveBeenCalledOnce();

    vi.advanceTimersByTime(30_000);
    startProjectSync(manager);
    await finished(manager);
    expect(mocks.sync).toHaveBeenCalledTimes(2);
  });

  it("applies a new interval from the next scan", async () => {
    mocks.sync.mockResolvedValue({ push: { status: "skipped" } });
    const manager = createManager({ ...on, syncIntervalSeconds: 3600 });

    startProjectSync(manager);
    await finished(manager);
    vi.advanceTimersByTime(120_000);
    startProjectSync(manager);
    expect(mocks.sync).toHaveBeenCalledOnce();

    manager.store.update(() => ({ settings: settings({ ...on, syncIntervalSeconds: 60 }) }));
    startProjectSync(manager);
    await finished(manager);
    expect(mocks.sync).toHaveBeenCalledTimes(2);
  });

  it("runs only one sync at a time", async () => {
    let release: (result: SyncResult) => void = () => {};
    mocks.sync.mockReturnValue(new Promise<SyncResult>((resolve) => (release = resolve)));
    const manager = createManager(on);

    startProjectSync(manager);
    await vi.waitFor(() => expect(mocks.sync).toHaveBeenCalledOnce());
    vi.advanceTimersByTime(600_000);
    startProjectSync(manager);
    expect(mocks.sync).toHaveBeenCalledOnce();
    expect(isSyncDue(manager.store.current, Date.now())).toBe(false);

    release({});
    await finished(manager);
    expect(manager.store.current.syncTask).toBeUndefined();
    expect(isSyncDue(manager.store.current, Date.now())).toBe(true);
  });

  it("does not sync with push and pull off, or while the factory stops", () => {
    const off = createManager({ push: false, pull: false, syncIntervalSeconds: 60 });
    startProjectSync(off);
    const defaults = createManager(undefined);
    startProjectSync(defaults);
    const stopping = createManager(on);
    stopping.store.update(() => ({ stopping: true }));
    startProjectSync(stopping);
    expect(mocks.sync).not.toHaveBeenCalled();
  });

  it("sets attention entries for failures and removes them after a success", async () => {
    const manager = createManager(on);
    mocks.sync.mockResolvedValueOnce({
      pull: { status: "failed", detail: "CONFLICT ".repeat(100) },
      push: { status: "failed", detail: "rejected" },
    });

    startProjectSync(manager);
    await finished(manager);

    const attention = manager.store.current.attention;
    expect(attention.get("push")).toEqual({ text: "Git push failed: rejected" });
    expect(attention.get("pull")?.text).toMatch(/^Git pull failed: CONFLICT/);
    expect(attention.get("pull")?.text.length).toBe(500);
    expect(mocks.persist).toHaveBeenCalledOnce();

    mocks.sync.mockResolvedValueOnce({ pull: { status: "failed", detail: "again" }, push: { status: "ok" } });
    vi.advanceTimersByTime(60_000);
    startProjectSync(manager);
    await finished(manager);
    expect(manager.store.current.attention.has("push")).toBe(false);
    expect(manager.store.current.attention.get("pull")).toEqual({ text: "Git pull failed: again" });

    mocks.sync.mockResolvedValueOnce({ pull: { status: "ok" }, push: { status: "skipped" } });
    vi.advanceTimersByTime(60_000);
    startProjectSync(manager);
    await finished(manager);
    expect(manager.store.current.attention.size).toBe(0);
  });

  it("keeps the factory running when the status write fails", async () => {
    mocks.persist.mockRejectedValueOnce(new Error("disk"));
    mocks.sync.mockResolvedValue({ push: { status: "failed", detail: "offline" } });
    const manager = createManager(on);

    startProjectSync(manager);
    await finished(manager);

    expect(manager.store.current.attention.get("push")).toEqual({ text: "Git push failed: offline" });
    expect(manager.store.current.syncTask).toBeUndefined();
  });
});
