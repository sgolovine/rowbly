import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { promisify } from "node:util";
import { InMemoryCredentialStore } from "@earendil-works/pi-ai";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createCliShim } from "../../commands/factory-runner/factory-runner.js";
import { listAttachments } from "../attachment/attachment.js";
import { HOST_SYNC_REASON } from "../factory-policy/factory-policy.js";
import { updateFactorySettings } from "../factory-settings/factory-settings.js";
import { readFactoryState } from "../factory-state/factory-state.js";
import type { HostRunState } from "../host-agent/host-run-state.js";
import { heldAction } from "../outbox-apply/held-actions.js";
import { readHeldEntries } from "../outbox-apply/held-entries.js";
import { readAppliedSeq } from "../outbox-apply/host-files.js";
import { loadPi } from "../pi-runtime/pi-runtime.js";
import { initProject } from "../project/project.js";
import { createStage } from "../stage/stage.js";
import { createStory, getStory } from "../story/story.js";
import { createScriptedHost, type ScriptedCommand, type ScriptedHost } from "../test-project/scripted-host.js";
import { useTempDir } from "../test-project/test-project.js";
import { createThread, getThread, type ThreadRecord } from "../thread/thread.js";
import { findProject } from "../workspace/workspace.js";
import { checkAbandonedResume, outcomeOf } from "./abandoned-threads.js";
import { createFactoryManager, type FactoryManager } from "./factory-manager.js";
import { changeThread } from "./manager-state.js";

vi.mock("./manager-state.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./manager-state.js")>();
  return { ...actual, changeThread: vi.fn(actual.changeThread) };
});

const exec = promisify(execFile);
const PROMPT = "Move this Story to Done. Report complete.";
const ROWBLY = "/opt/rowbly/bin/rowbly";
const HOSTS = [{ id: "mini", maxWorkers: 2, state: "connected" as const, providers: ["worker"] }];
const RESULT = { outcome: "complete", summary: "Working on mini", blockers: [], problems: [] };
const LATE = { outcome: "complete", summary: "Ended after the cancel", blockers: [], problems: [] };
const PNG = Buffer.from("89504e470d0a1a0a0000000d49484452", "hex");
const HASH = createHash("sha256").update(PNG).digest("hex");
const ATTACHMENT = {
  id: `a${"1".repeat(36)}`,
  name: "shot.png",
  type: "image/png",
  size: 16,
  createdAt: "2026-11-16T10:00:00.000Z",
};

/** Sends the progress of a run with an open session when the host gets the launch command. */
function running(command: ScriptedCommand, host: ScriptedHost): void {
  const worktree = { path: "/host/repo-worktrees/x", branch: "story/x" };
  const session = { model: { provider: "worker", modelId: "faux" }, file: `sessions/${command.threadId}/s.jsonl` };
  if (command.type === "launch")
    host.sendRun(command.threadId, { phase: "running", worktree, session, result: RESULT });
  if (command.type === "cancel-thread") {
    host.sendRun(command.threadId, { phase: "ended", worktree, session, result: RESULT, endReason: "cancelled" });
  }
}

function titleEntry(seq: number, threadId: string, storyId: string, before: string, after: string) {
  return { seq, opId: `op-${seq}`, threadId, storyId, changes: [{ path: "title", before, after }] };
}

describe("outcomeOf", () => {
  it("gives the end reason, the end time, the result and the failure of the last frame", () => {
    const frame = {
      endReason: "failed",
      endedAt: "2026-11-16T10:00:00.000Z",
      result: LATE,
      failure: { code: "X", message: "Broken", sessionOpened: true },
    } as unknown as HostRunState;

    expect(outcomeOf(frame)).toEqual({
      endReason: "failed",
      endedAt: "2026-11-16T10:00:00.000Z",
      result: LATE,
      failure: { code: "X", message: "Broken" },
    });
    expect(outcomeOf({ phase: "ended" } as HostRunState)).toEqual({ endReason: "completed" });
  });
});

describe("factory manager with an abandoned remote Thread", () => {
  const dir = useTempDir();
  let manager: FactoryManager | undefined;
  let root: string;

  beforeEach(async () => {
    vi.mocked(changeThread).mockClear();
    root = join(dir.path, "project");
    await mkdir(root);
    vi.stubEnv("HOME", join(dir.path, "home"));
    vi.stubEnv("PI_CODING_AGENT_DIR", join(dir.path, "agent"));
    vi.stubEnv("PI_OFFLINE", "1");
    await initProject({ name: "Test", key: "TST" }, { cwd: root });
    await createStage({ label: "Work", key: "WORK", prompt: PROMPT, position: 2 }, { cwd: root });
    await exec("git", ["init", root]);
    await exec("git", ["-C", root, "add", ".rowbly"]);
    await exec("git", ["-C", root, "-c", "user.name=T", "-c", "user.email=t@example.com", "commit", "-m", "initial"]);
  });

  afterEach(async () => {
    await manager?.shutdown();
    manager = undefined;
    vi.unstubAllEnvs();
  });

  async function fixture(host: ScriptedHost) {
    const sdk = await loadPi();
    const runtime = await sdk.ModelRuntime.create({
      credentials: new InMemoryCredentialStore(),
      modelsPath: null,
      refreshOnCreate: false,
      allowModelNetwork: false,
    });
    const { fauxProvider } = await import("@earendil-works/pi-ai");
    const worker = fauxProvider({ provider: "worker", api: "worker-faux" });
    runtime.registerNativeProvider(worker.provider);
    await updateFactorySettings(
      { maxWorkers: 1, workerModel: { provider: "worker", modelId: worker.getModel().id } },
      { cwd: root },
    );
    const shim = await createCliShim(
      {
        executable: process.execPath,
        execArgv: ["--import", resolve("node_modules/tsx/dist/loader.mjs")],
        entry: resolve("src/cli.ts"),
      },
      { cwd: root },
    );
    manager = await createFactoryManager(
      {
        runtime,
        agentDir: join(dir.path, "agent"),
        shim,
        workerHosts: async () => HOSTS,
        worktreeFacts: async () => undefined,
        hostConnection: async () => ({ transport: host.transport, rowbly: ROWBLY, clone: "repo" }),
        hostHeartbeat: { intervalMs: 50, timeoutMs: 5000 },
      },
      { cwd: root },
    );
    return manager;
  }

  async function runningThread(f: FactoryManager, storyId: string): Promise<ThreadRecord> {
    const { threadId } = await f.reserveWorker({ storyId, stage: "WORK", requestId: storyId, host: "mini" });
    return vi.waitFor(
      async () => {
        const thread = await getThread(threadId, { cwd: root });
        expect(thread.status).toBe("running");
        expect(thread.result).toEqual(RESULT);
        return thread;
      },
      { timeout: 10_000, interval: 20 },
    );
  }

  async function freeSlot(f: FactoryManager) {
    await vi.waitFor(async () => expect((await f.snapshot()).hosts[1]).toMatchObject({ id: "mini", used: 0 }), {
      timeout: 10_000,
      interval: 20,
    });
  }

  it("abandons a Thread that is cancelled while its host is offline, and holds its later entries", async () => {
    const host = createScriptedHost({ onSubmit: (command, h) => command.type === "launch" && running(command, h) });
    const f = await fixture(host);
    const story = await createStory({ title: "Remote", stage: "WORK" }, { cwd: root });
    const other = await createStory({ title: "Other", stage: "BACKLOG" }, { cwd: root });
    const thread = await runningThread(f, story.id);

    host.transport.disconnect();
    await vi.waitFor(() => expect(host.transport.openChannels).toBe(0));
    await f.cancelWorker(thread.id, thread.runs.at(-1)?.id ?? "");
    await freeSlot(f);

    const cancelled = await getThread(thread.id, { cwd: root });
    expect(cancelled.status).toBe("cancelled");
    expect(cancelled.abandoned).toEqual({ at: expect.any(String), reason: "cancel", appliedSeq: 0 });
    const reason = (await f.reconcile()).find((d) => d.story === story.id)?.reason;
    expect(reason).not.toBe(HOST_SYNC_REASON);
    expect(reason).toBe("cancelled by user");
    const queue = JSON.parse(await readFile(join(root, ".rowbly/runtime/hosts/mini/commands.json"), "utf8"));
    expect(queue.commands).toEqual([expect.objectContaining({ type: "cancel-thread", threadId: thread.id })]);

    // The worker on the host writes more entries after the cancel. The entry of a different Thread is applied.
    host.addOutbox(titleEntry(1, thread.id, story.id, "Remote", "Late"));
    host.addOutbox({
      seq: 2,
      opId: "op-2",
      threadId: thread.id,
      storyId: story.id,
      type: "attachment.add",
      attachment: ATTACHMENT,
      sha256: HASH,
    } as { seq: number });
    host.addBlob(HASH, PNG);
    host.addOutbox(titleEntry(3, "other-thread", other.id, "Other", "Applied"));
    const results = vi.mocked(changeThread).mock.calls.filter((call) => call[1] === thread.id && call[3]?.result);
    const mark = host.events.length;

    host.transport.reconnect();
    await vi.waitFor(() => expect(host.events.slice(mark)).toContain("attach"), { timeout: 10_000, interval: 20 });
    host.sendRun(thread.id, {
      phase: "ended",
      endReason: "cancelled",
      endedAt: "2026-11-16T11:00:00.000Z",
      result: LATE,
    });

    const ended = await vi.waitFor(
      async () => {
        const value = await getThread(thread.id, { cwd: root });
        expect(value.remoteOutcome).toBeDefined();
        return value;
      },
      { timeout: 10_000, interval: 20 },
    );

    // The stop goes first, then the channel, then the outbox sync.
    const steps = host.events.slice(mark).filter((event) => event !== "ping");
    expect(steps.slice(0, 3)).toEqual(["submit:cancel-thread", "attach", "outbox"]);

    expect(ended.status).toBe("cancelled");
    expect(ended.remoteOutcome).toEqual({ endReason: "cancelled", endedAt: "2026-11-16T11:00:00.000Z", result: LATE });
    expect(ended.result).toEqual(RESULT);
    const calls = vi.mocked(changeThread).mock.calls.filter((call) => call[1] === thread.id);
    expect(calls.filter((call) => call[2] === "completed")).toHaveLength(0);
    expect(calls.filter((call) => call[3]?.result)).toHaveLength(results.length);

    // The canonical Story does not change. The entries and the PNG are held, and the host got the acknowledgement.
    expect((await getStory({ id: story.id }, { cwd: root })).title).toBe("Remote");
    expect((await getStory({ id: story.id }, { cwd: root })).stage).toBe("WORK");
    expect(await listAttachments({ story: story.id }, { cwd: root })).toEqual([]);
    expect((await getStory({ id: other.id }, { cwd: root })).title).toBe("Applied");
    const projectPaths = await findProject({ cwd: root });
    expect((await readHeldEntries(projectPaths, "mini", thread.id)).map((entry) => entry.seq)).toEqual([1, 2]);
    const blob = join(projectPaths.runtimeDir, "hosts/mini/held", thread.id, "blobs", `${HASH}.png`);
    expect(await readFile(blob)).toEqual(PNG);
    expect(await readAppliedSeq(projectPaths, "mini")).toBe(3);
    const acks = host.requests.filter((request) => request.command[2] === "outbox-ack");
    expect(acks.at(-1)?.input).toEqual({ seq: 3 });
    expect(host.outbox).toEqual([]);

    // One attention entry for the Thread. A dismiss removes the entry, not the held entries.
    const key = `abandoned:${thread.id}`;
    const attention = (await f.snapshot()).attention as unknown as [string, { text: string; storyId?: string }][];
    const entry = attention.filter(([name]) => name === key);
    expect(entry).toHaveLength(1);
    expect(entry[0]?.[1].storyId).toBe(story.id);
    expect(entry[0]?.[1].text).toContain("host mini has 2 held entries");
    expect(entry[0]?.[1].text).toContain(`attachment ${ATTACHMENT.id}`);
    await f.dismissAttention(key);
    expect(((await f.snapshot()).attention as unknown as [string][]).some(([name]) => name === key)).toBe(false);
    expect(await readHeldEntries(projectPaths, "mini", thread.id)).toHaveLength(2);

    // The resume gate: held entries or a host that is not connected refuse the resume.
    await expect(checkAbandonedResume(projectPaths, ended, "connected")).rejects.toMatchObject({ code: "CONFLICT" });
    await heldAction({ id: thread.id, discard: true }, { cwd: root });
    await expect(checkAbandonedResume(projectPaths, ended, "disconnected")).rejects.toMatchObject({
      code: "CONFLICT",
    });
    await expect(checkAbandonedResume(projectPaths, ended, "connected")).resolves.toBeUndefined();
    expect((await getStory({ id: story.id }, { cwd: root })).title).toBe("Remote");
  }, 60_000);

  it("does not abandon a Thread that is cancelled while its host has an open channel", async () => {
    const host = createScriptedHost({ onSubmit: (command, h) => running(command, h) });
    const f = await fixture(host);
    const story = await createStory({ title: "Remote", stage: "WORK" }, { cwd: root });
    const thread = await runningThread(f, story.id);
    host.addOutbox(titleEntry(1, thread.id, story.id, "Remote", "Changed"));

    await f.cancelWorker(thread.id, thread.runs.at(-1)?.id ?? "");
    await freeSlot(f);

    const cancelled = await getThread(thread.id, { cwd: root });
    expect(cancelled.status).toBe("cancelled");
    expect(cancelled.abandoned).toBeUndefined();
    expect(cancelled.remoteOutcome).toBeUndefined();
    await vi.waitFor(async () => expect((await getStory({ id: story.id }, { cwd: root })).title).toBe("Changed"), {
      timeout: 10_000,
      interval: 20,
    });
    expect(host.commands.map((command) => command.type)).toEqual(["launch", "cancel-thread"]);
  }, 60_000);
  async function hostOffline(f: FactoryManager) {
    await vi.waitFor(async () => expect((await f.snapshot()).hosts[1]?.state).not.toBe("connected"), {
      timeout: 10_000,
      interval: 20,
    });
  }

  async function nativeCancelled(): Promise<Record<string, unknown>> {
    return ((await readFactoryState(root)).nativeCancelled ?? {}) as Record<string, unknown>;
  }

  it("releases a Thread while its host is offline: no user hold, a local worker starts, later entries are held", async () => {
    const host = createScriptedHost({ onSubmit: (command, h) => command.type === "launch" && running(command, h) });
    const f = await fixture(host);
    const story = await createStory({ title: "Remote", stage: "WORK" }, { cwd: root });
    const thread = await runningThread(f, story.id);

    host.transport.disconnect();
    await vi.waitFor(() => expect(host.transport.openChannels).toBe(0));
    await f.releaseWorker(thread.id, thread.runs.at(-1)?.id ?? "");
    await freeSlot(f);

    const released = await getThread(thread.id, { cwd: root });
    expect(released.status).toBe("cancelled");
    expect(released.resumable).toBe(true);
    expect(released.abandoned).toEqual({ at: expect.any(String), reason: "release", appliedSeq: 0 });
    const queue = JSON.parse(await readFile(join(root, ".rowbly/runtime/hosts/mini/commands.json"), "utf8"));
    expect(queue.commands).toEqual([expect.objectContaining({ type: "cancel-thread", threadId: thread.id })]);

    // No user hold: the scan does not give "cancelled by user" or the host sync, and the state has no entry.
    const reason = (await f.reconcile()).find((d) => d.story === story.id)?.reason;
    expect(reason).not.toBe("cancelled by user");
    expect(reason).not.toBe(HOST_SYNC_REASON);
    expect(await nativeCancelled()).not.toHaveProperty(story.id);

    // While mini stays disconnected, the placement selects the local host for a new worker.
    await hostOffline(f);
    const next = await f.reserveWorker({ storyId: story.id, stage: "WORK", requestId: "after-release" });
    expect((await getThread(next.threadId, { cwd: root })).host).toBe("local");
    await vi.waitFor(async () => expect((await f.snapshot()).hosts[0]).toMatchObject({ id: "local", used: 0 }), {
      timeout: 10_000,
      interval: 20,
    });

    // After the reconnect, the later outbox entries of the released Thread are held as for a cancel.
    host.addOutbox(titleEntry(1, thread.id, story.id, "Remote", "Late"));
    const mark = host.events.length;
    host.transport.reconnect();
    await vi.waitFor(() => expect(host.events.slice(mark)).toContain("attach"), { timeout: 10_000, interval: 20 });
    host.sendRun(thread.id, { phase: "ended", endReason: "cancelled", result: LATE });
    await vi.waitFor(async () => expect((await getThread(thread.id, { cwd: root })).remoteOutcome).toBeDefined(), {
      timeout: 10_000,
      interval: 20,
    });
    const steps = host.events.slice(mark).filter((event) => event !== "ping");
    expect(steps.slice(0, 3)).toEqual(["submit:cancel-thread", "attach", "outbox"]);
    const projectPaths = await findProject({ cwd: root });
    expect((await readHeldEntries(projectPaths, "mini", thread.id)).map((entry) => entry.seq)).toEqual([1]);
    expect((await getStory({ id: story.id }, { cwd: root })).title).toBe("Remote");
  }, 60_000);

  it("keeps a cancelled Story on its offline host: the placement waits for the host", async () => {
    const host = createScriptedHost({ onSubmit: (command, h) => command.type === "launch" && running(command, h) });
    const f = await fixture(host);
    const story = await createStory({ title: "Remote", stage: "WORK" }, { cwd: root });
    const thread = await runningThread(f, story.id);

    host.transport.disconnect();
    await vi.waitFor(() => expect(host.transport.openChannels).toBe(0));
    await f.cancelWorker(thread.id, thread.runs.at(-1)?.id ?? "");
    await freeSlot(f);
    await hostOffline(f);

    await expect(
      f.reserveWorker({ storyId: story.id, stage: "WORK", requestId: "after-cancel" }),
    ).rejects.toMatchObject({ code: "CONFLICT", message: expect.stringContaining("the Story waits for host mini") });
  }, 60_000);

  it("releases a Thread whose host has an open channel without an abandoned note or a user hold", async () => {
    const host = createScriptedHost({ onSubmit: (command, h) => running(command, h) });
    const f = await fixture(host);
    const story = await createStory({ title: "Remote", stage: "WORK" }, { cwd: root });
    const thread = await runningThread(f, story.id);

    await f.releaseWorker(thread.id, thread.runs.at(-1)?.id ?? "");
    await freeSlot(f);

    const released = await getThread(thread.id, { cwd: root });
    expect(released.status).toBe("cancelled");
    expect(released.abandoned).toBeUndefined();
    expect(host.commands.map((command) => command.type)).toEqual(["launch", "cancel-thread"]);
    expect(await nativeCancelled()).not.toHaveProperty(story.id);
    expect((await f.reconcile()).find((d) => d.story === story.id)?.reason).not.toBe("cancelled by user");
  }, 60_000);

  it("refuses the release of a local Thread", async () => {
    const host = createScriptedHost({});
    const f = await fixture(host);
    const story = await createStory({ title: "Local", stage: "WORK" }, { cwd: root });
    const local = await createThread(
      { role: "worker", storyId: story.id, stage: "WORK", cwd: root, ownerToken: f.owner.token },
      { cwd: root },
    );

    await expect(f.releaseWorker(local.id, local.runs.at(-1)?.id ?? "")).rejects.toMatchObject({
      code: "CONFLICT",
      message: expect.stringContaining("worker host"),
    });
    expect((await getThread(local.id, { cwd: root })).status).toBe("pending");
  }, 60_000);
});
