import { execFile } from "node:child_process";
import { mkdir } from "node:fs/promises";
import { join, resolve } from "node:path";
import { promisify } from "node:util";
import { fauxProvider, InMemoryCredentialStore } from "@earendil-works/pi-ai";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createCliShim } from "../../commands/factory-runner/factory-runner.js";
import { HOST_SYNC_REASON } from "../factory-policy/factory-policy.js";
import { updateFactorySettings } from "../factory-settings/factory-settings.js";
import type { HostRunState } from "../host-agent/host-run-state.js";
import type { HostTransport } from "../host-transport/host-transport.js";
import { loadPi } from "../pi-runtime/pi-runtime.js";
import { initProject } from "../project/project.js";
import { createStage } from "../stage/stage.js";
import { createStory } from "../story/story.js";
import { createScriptedHost, type ScriptedCommand, type ScriptedHost } from "../test-project/scripted-host.js";
import { useTempDir } from "../test-project/test-project.js";
import { getThread, listThreads, type ThreadRecord } from "../thread/thread.js";
import { createFactoryManager, type FactoryManager } from "./factory-manager.js";
import { withSyncAttention } from "./remote-dispatch.js";

const exec = promisify(execFile);
const PROMPT = "Move this Story to Done. Report complete.";
const ROWBLY = "/opt/rowbly/bin/rowbly";
const HOSTS = [{ id: "mini", maxWorkers: 2, state: "connected" as const, providers: ["worker"] }];
const RESULT = { outcome: "complete", summary: "Done on mini", blockers: [], problems: [] };

describe("withSyncAttention", () => {
  it("sets one entry for each host whose sync failed, and removes the entries of the other hosts", () => {
    const attention = new Map([
      ["host-sync:old", { text: "old" }],
      ["reconcile", { text: "keep" }],
    ]);

    expect([...withSyncAttention(attention, new Map([["mini", "offline"]]))]).toEqual([
      ["reconcile", { text: "keep" }],
      ["host-sync:mini", { text: "Outbox sync of host mini failed: offline" }],
    ]);
  });
});

/** Sends the progress of a run with an open session when the host gets the launch command. */
function running(command: ScriptedCommand, host: ScriptedHost, end?: Partial<HostRunState>): void {
  if (command.type !== "launch") return;
  const worktree = { path: "/host/repo-worktrees/x", branch: "story/x" };
  const session = { model: { provider: "worker", modelId: "faux" }, file: `sessions/${command.threadId}/s.jsonl` };
  host.sendRun(command.threadId, { phase: "running", worktree, session, result: RESULT });
  if (end) host.sendRun(command.threadId, { phase: "ended", worktree, session, result: RESULT, ...end });
}

describe("factory manager with a scripted worker host", () => {
  const dir = useTempDir();
  let manager: FactoryManager | undefined;
  let root: string;

  beforeEach(async () => {
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

  async function fixture(transport: HostTransport, checks = false) {
    const sdk = await loadPi();
    const runtime = await sdk.ModelRuntime.create({
      credentials: new InMemoryCredentialStore(),
      modelsPath: null,
      refreshOnCreate: false,
      allowModelNetwork: false,
    });
    const worker = fauxProvider({ provider: "worker", api: "worker-faux" });
    runtime.registerNativeProvider(worker.provider);
    await updateFactorySettings(
      {
        maxWorkers: 1,
        workerModel: { provider: "worker", modelId: worker.getModel().id },
        ...(checks ? { checks: { items: [{ key: "test", command: "pnpm test" }] } } : {}),
      },
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
        hostConnection: async () => ({ transport, rowbly: ROWBLY, clone: "repo" }),
      },
      { cwd: root },
    );
    return { manager, worker };
  }

  async function ended(id: string): Promise<ThreadRecord> {
    return vi.waitFor(
      async () => {
        const thread = await getThread(id, { cwd: root });
        expect(["pending", "running"]).not.toContain(thread.status);
        return thread;
      },
      { timeout: 10_000, interval: 20 },
    );
  }

  async function freeSlot(f: { manager: FactoryManager }) {
    await vi.waitFor(async () => expect((await f.manager.snapshot()).hosts[1]).toMatchObject({ id: "mini", used: 0 }), {
      timeout: 10_000,
      interval: 20,
    });
  }

  it.each([
    [
      "failed",
      { endReason: "failed", failure: { code: "HOST_NO_FREE_SLOT", message: "No free slot", sessionOpened: true } },
      "failed",
    ],
    ["stopped", { endReason: "stopped" }, "interrupted"],
    ["cancelled", { endReason: "cancelled" }, "cancelled"],
  ] as const)("makes the Thread of a run that ended with %s on the host %s", async (_reason, end, status) => {
    const host = createScriptedHost({ onSubmit: (command, h) => running(command, h, end as Partial<HostRunState>) });
    const f = await fixture(host.transport);
    const story = await createStory({ title: "Remote", stage: "WORK" }, { cwd: root });

    const { threadId } = await f.manager.reserveWorker({
      storyId: story.id,
      stage: "WORK",
      requestId: "r",
      host: "mini",
    });
    const thread = await ended(threadId);

    expect(thread).toMatchObject({ status, host: "mini", worktree: "/host/repo-worktrees/x" });
    if (status === "failed") {
      expect(thread.error).toMatchObject({ code: "HOST_NO_FREE_SLOT", message: "No free slot" });
    } else {
      expect(thread.resumable).toBe(true);
    }
    await freeSlot(f);
  });

  it("gives a remote worker the paths of the host and no checks block", async () => {
    const host = createScriptedHost({
      onSubmit: (command, h) => {
        if (command.type === "cancel-thread") h.sendRun(command.threadId, { phase: "ended", endReason: "cancelled" });
      },
    });
    const f = await fixture(host.transport, true);
    const story = await createStory({ title: "Remote", stage: "WORK" }, { cwd: root });

    const { threadId } = await f.manager.reserveWorker({
      storyId: story.id,
      stage: "WORK",
      requestId: "r",
      host: "mini",
    });
    const prepare = await vi.waitFor(
      () => {
        const request = host.requests.find((entry) => entry.command[2] === "prepare");
        expect(request).toBeDefined();
        return request?.input as { message: string };
      },
      { timeout: 10_000, interval: 20 },
    );

    const agent = "/host/agent";
    expect(prepare.message).toContain(`Canonical Project root: \`${agent}/threads/${threadId}/copy\``);
    expect(prepare.message).toContain(`Worktree: \`/host/repo-worktrees/${story.id}\``);
    expect(prepare.message).toContain(
      `Command prefix: \`flock -w 60 '${agent}/threads/${threadId}/write.lock' '${agent}/bin/rowbly' -C '${agent}/threads/${threadId}/copy' --json\``,
    );
    expect(prepare.message).not.toContain("run_check");
    expect(prepare.message).not.toContain("Checks (run each");

    const thread = await getThread(threadId, { cwd: root });
    await f.manager.cancelWorker(threadId, thread.runs.at(-1)?.id ?? "");
    await freeSlot(f);
  });

  it("keeps the last status when the channel closes before the end, and starts no second worker", async () => {
    const host = createScriptedHost({ onSubmit: (command, h) => running(command, h) });
    const f = await fixture(host.transport);
    const story = await createStory({ title: "Remote", stage: "WORK" }, { cwd: root });

    const { threadId } = await f.manager.reserveWorker({
      storyId: story.id,
      stage: "WORK",
      requestId: "r",
      host: "mini",
    });
    await vi.waitFor(async () => expect((await getThread(threadId, { cwd: root })).result).toEqual(RESULT), {
      timeout: 10_000,
      interval: 20,
    });
    host.closeChannels();
    await vi.waitFor(() => expect(host.transport.openChannels).toBe(0));
    await new Promise((done) => setTimeout(done, 100));

    expect((await getThread(threadId, { cwd: root })).status).toBe("running");
    expect((await f.manager.reconcile()).find((d) => d.story === story.id)?.reason).toBe(HOST_SYNC_REASON);
    await expect(
      f.manager.reserveWorker({ storyId: story.id, stage: "WORK", requestId: "second", host: "mini" }),
    ).rejects.toMatchObject({ code: "CONFLICT" });
    expect((await listThreads({ role: "worker" }, { cwd: root })).threads).toHaveLength(1);

    // A cancel while the channel is closed ends the wait of the launch without an event of the host.
    const thread = await getThread(threadId, { cwd: root });
    await f.manager.cancelWorker(threadId, thread.runs.at(-1)?.id ?? "");
    await freeSlot(f);
    expect((await getThread(threadId, { cwd: root })).status).toBe("cancelled");
    expect((await f.manager.reconcile()).find((d) => d.story === story.id)?.reason).toBe("cancelled by user");
  });

  it("submits cancel-thread for cancelWorker and stop-thread at a factory stop, and refuses a steering message", async () => {
    const host = createScriptedHost({
      onSubmit: (command, h) => {
        running(command, h);
        if (command.type === "cancel-thread") h.sendRun(command.threadId, { phase: "ended", endReason: "cancelled" });
        if (command.type === "stop-thread") h.sendRun(command.threadId, { phase: "ended", endReason: "stopped" });
      },
    });
    const f = await fixture(host.transport);
    const first = await createStory({ title: "Cancel", stage: "WORK" }, { cwd: root });
    const second = await createStory({ title: "Stop", stage: "WORK" }, { cwd: root });
    const isRunning = async (id: string) =>
      vi.waitFor(async () => expect((await getThread(id, { cwd: root })).status).toBe("running"), {
        timeout: 10_000,
        interval: 20,
      });

    const cancelled = await f.manager.reserveWorker({ storyId: first.id, stage: "WORK", requestId: "a", host: "mini" });
    await isRunning(cancelled.threadId);
    const cancelRun = (await getThread(cancelled.threadId, { cwd: root })).runs.at(-1)?.id ?? "";
    await expect(f.manager.steerWorker(cancelled.threadId, cancelRun, "Hello")).rejects.toMatchObject({
      code: "CONFLICT",
    });
    await f.manager.cancelWorker(cancelled.threadId, cancelRun);
    expect((await ended(cancelled.threadId)).status).toBe("cancelled");
    expect(host.commands.filter((c) => c.threadId === cancelled.threadId).map((c) => c.type)).toEqual([
      "launch",
      "cancel-thread",
    ]);

    const stopped = await f.manager.reserveWorker({ storyId: second.id, stage: "WORK", requestId: "b", host: "mini" });
    await isRunning(stopped.threadId);
    await f.manager.shutdown();
    expect((await ended(stopped.threadId)).status).toBe("interrupted");
    expect(host.commands.filter((c) => c.threadId === stopped.threadId).map((c) => c.type)).toEqual([
      "launch",
      "stop-thread",
    ]);
  });
});
