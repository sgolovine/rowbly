import { describe, expect, it, vi } from "vitest";
import { useTempDir, useTestProject } from "../test-project/test-project.js";

vi.mock("@earendil-works/pi-coding-agent", () => {
  throw new Error("Pi loaded during command registration");
});

describe("Pi import boundary", () => {
  const project = useTestProject();
  const home = useTempDir();

  it("reads and writes the model cache without loading Pi", async () => {
    const cache = await import("../pi-catalog-cache/pi-catalog-cache.js");
    const ctx = { home: home.path };
    const catalog = { models: [], providers: [] };
    await cache.writePiCatalog(catalog, await cache.piCatalogKey(ctx, { env: {} }), ctx);
    expect(await cache.readPiCatalog(ctx, { env: {} })).toEqual({ ...catalog, fresh: true });
    await cache.deletePiCatalog(ctx);
    expect(await cache.readPiCatalog(ctx, { env: {} })).toBeUndefined();
  });

  it("does not load Pi for help or command registration", async () => {
    const { createProgram } = await import("../../commands/test-cli/test-cli.js");
    expect(createProgram().helpInformation()).toContain("Usage:");
    await expect(import("./pi-runtime.js")).resolves.toHaveProperty("loadPi");
  });

  it("imports the Pi worker client without loading Pi or starting a worker", async () => {
    const client = await import("./pi-worker-client.js");
    expect(client.piWorkerSource()).toHaveProperty("listAvailableModels");
  });

  it("reads factory status without loading Pi or credentials", async () => {
    const { runCli } = await import("../../commands/test-cli/test-cli.js");
    const result = await runCli(["--json", "factory", "status"], project.paths.root);
    expect(result.exitCode).toBe(0);
    expect(JSON.parse(result.stdout).phase).toBe("stopped");
  });

  it("runs the factory watchdog without loading Pi", async () => {
    const { writeFile } = await import("node:fs/promises");
    const { join } = await import("node:path");
    const { runWatchdog } = await import("../../commands/factory-runner/watchdog-runner.js");
    const entry = join(project.paths.root, "clean-daemon.mjs");
    await writeFile(entry, "process.exit(0);\n");
    const launch = { executable: process.execPath, execArgv: [], entry };
    await expect(runWatchdog({ launch }, project.ctx)).resolves.toMatchObject({ phase: "stopped" });
    await import("../factory-watchdog/factory-watchdog.js");
  });

  it("reads the project status without loading Pi", async () => {
    const { runCli } = await import("../../commands/test-cli/test-cli.js");
    const result = await runCli(["--json", "status"], project.paths.root);
    expect(result.exitCode).toBe(0);
    expect(JSON.parse(result.stdout).factory.phase).toBe("stopped");
  });

  it("imports the connection facts of the Threads without loading Pi, the host transport or the remote executor", async () => {
    const { readFile } = await import("node:fs/promises");
    await expect(import("../thread-connection/connection-lost.js")).resolves.toHaveProperty("lostConnections");
    await expect(import("../thread-connection/thread-connection.js")).resolves.toHaveProperty(
      "listThreadsWithConnection",
    );
    for (const file of ["connection-lost.ts", "thread-connection.ts"]) {
      const source = await readFile(new URL(`../thread-connection/${file}`, import.meta.url), "utf8");
      expect(source).not.toMatch(/host-transport|remote-executor/);
    }
  });

  it("imports the worker executor interface without loading Pi", async () => {
    await expect(import("../factory-manager/worker-executor.js")).resolves.toHaveProperty("workerControl");
  });

  it("imports the host transport without loading Pi", async () => {
    await expect(import("../host-transport/host-transport.js")).resolves.toHaveProperty("HOST_PROTOCOL_VERSION", 2);
    await expect(import("../host-transport/host-handshake.js")).resolves.toHaveProperty("openHostChannel");
    await expect(import("../host-transport/host-errors.js")).resolves.toHaveProperty("classifySshExit");
    await expect(import("../host-transport/json-lines.js")).resolves.toHaveProperty("decodeChunk");
    await expect(import("../host-transport/ssh-transport.js")).resolves.toHaveProperty("createSshTransport");
    await expect(import("../host-transport/ssh-process.js")).resolves.toHaveProperty("runSshCall");
    await expect(import("../host-transport/ssh-channel.js")).resolves.toHaveProperty("startSshChannel");
    await expect(import("../test-project/fake-host-transport.js")).resolves.toHaveProperty("createFakeHostTransport");
  });

  it("imports the remote executor and its modules without loading Pi", async () => {
    await expect(import("../remote-executor/remote-executor.js")).resolves.toHaveProperty("createRemoteExecutor");
    await expect(import("../remote-executor/remote-calls.js")).resolves.toHaveProperty("submit");
    await expect(import("../remote-executor/remote-channel.js")).resolves.toHaveProperty("ensureLink");
    await expect(import("../remote-executor/remote-attachment.js")).resolves.toHaveProperty("takeAttachmentRequest");
    await expect(import("../remote-executor/remote-run.js")).resolves.toHaveProperty("takeRunFrame");
    await expect(import("../remote-executor/run-frames.js")).resolves.toHaveProperty("newFacts");
    await expect(import("../remote-executor/remote-heartbeat.js")).resolves.toHaveProperty("nextHostState");
    await expect(import("../remote-executor/host-command-queue.js")).resolves.toHaveProperty("queueCommand");
    await expect(import("../remote-executor/remote-commands.js")).resolves.toHaveProperty("sendQueued");
    await expect(import("../remote-executor/remote-reconnect.js")).resolves.toHaveProperty("reconnectHost");
    await expect(import("../remote-executor/remote-stop.js")).resolves.toHaveProperty("shutdownRemote");
    await expect(import("../remote-executor/remote-sync.js")).resolves.toHaveProperty("syncHosts");
    await expect(import("../remote-executor/remote-abandoned.js")).resolves.toHaveProperty("flushOutcomes");
    await expect(import("../factory-manager/abandoned-threads.js")).resolves.toHaveProperty("pendingAbandoned");
    await expect(import("../factory-manager/abandoned-attention.js")).resolves.toHaveProperty("heldAttention");
    await expect(import("../remote-executor/session-mirror.js")).resolves.toHaveProperty("takeSessionFrame");
    await expect(import("../factory-manager/host-heartbeat.js")).resolves.toHaveProperty("startHostHeartbeat");
    await expect(import("../host-agent/host-ping.js")).resolves.toHaveProperty("hostPing");
    await expect(import("../factory-manager/remote-dispatch.js")).resolves.toHaveProperty("executorFor");
    await expect(import("../test-project/scripted-host.js")).resolves.toHaveProperty("createScriptedHost");
  });

  it("imports the outbox apply and the host outbox commands without loading Pi", async () => {
    await expect(import("../outbox/outbox-compare.js")).resolves.toHaveProperty("compareChange");
    await expect(import("../outbox/outbox-host.js")).resolves.toHaveProperty("hostOutboxEntries");
    await expect(import("../outbox-apply/outbox-apply.js")).resolves.toHaveProperty("syncOutbox");
    await expect(import("../outbox-apply/outbox-source.js")).resolves.toHaveProperty("transportOutboxSource");
    await expect(import("../outbox-apply/host-files.js")).resolves.toHaveProperty("readAppliedSeq");
    await expect(import("../factory-manager/outbox-attention.js")).resolves.toHaveProperty("syncHostOutbox");
    await expect(import("../outbox-apply/held-entries.js")).resolves.toHaveProperty("holdEntry");
    await expect(import("../outbox-apply/held-actions.js")).resolves.toHaveProperty("heldAction");
  });

  it("imports the host install service without loading Pi", async () => {
    await expect(import("../host-install/host-install.js")).resolves.toHaveProperty("ensureHostVersion");
    await expect(import("../host-install/node-check.js")).resolves.toHaveProperty("checkHostNode");
    await expect(import("../host-install/local-build.js")).resolves.toHaveProperty("localBuild");
    await expect(import("../host-install/host-install-errors.js")).resolves.toHaveProperty("HostInstallFailedError");
    await expect(import("../host/host.js")).resolves.toHaveProperty("addHost");
  });

  it("imports and runs the host check and the host login without loading Pi", async () => {
    const { runHostCheck } = await import("../host-check/host-check.js");
    const answers = await import("../test-project/fake-host-answers.js");
    const { createFakeHostTransport } = await import("../test-project/fake-host-transport.js");
    const transport = createFakeHostTransport({
      bytes: (command) => answers.answerFor(answers.healthyAnswers(), command),
    });
    const build = { id: "0.18.0", version: "0.18.0", released: true };

    await expect(
      runHostCheck({ hostId: "mini", transport, build }, project.ctx, {
        cloneFor: async () => "/srv/rowbly",
        localAhead: async () => 0,
      }),
    ).resolves.toHaveProperty("ready", true);
    await expect(import("../host-check/check-item.js")).resolves.toHaveProperty("CHECK_ITEM_IDS");
    await expect(import("../host-check/host-items.js")).resolves.toHaveProperty("linuxItem");
    await expect(import("../host-check/pi-items.js")).resolves.toHaveProperty("piLoginItem");
    await expect(import("../host-check/project-items.js")).resolves.toHaveProperty("localAheadItem");
    await expect(import("../host-check/host-login.js")).resolves.toHaveProperty("hostLoginArguments");
    await expect(import("../host-check/clone-finder.js")).resolves.toHaveProperty("hostCloneFinder");
  });

  it("imports the host agent without loading Pi", async () => {
    await expect(import("../host-agent/host-agent.js")).resolves.toHaveProperty("runHostAgent");
    await expect(import("../host-agent/host-agent-paths.js")).resolves.toHaveProperty("hostAgentPaths");
    await expect(import("../host-agent/host-agent-claim.js")).resolves.toHaveProperty("liveAgent");
    await expect(import("../host-agent/host-agent-control.js")).resolves.toHaveProperty("submitHostCommand");
    await expect(import("../host-agent/host-agent-work.js")).resolves.toHaveProperty("executeCommand");
    await expect(import("../host-agent/host-slots.js")).resolves.toHaveProperty("acquireSlot");
    await expect(import("../host-agent/host-attach.js")).resolves.toHaveProperty("runHostAttach");
    await expect(import("../host-agent/host-attach-fetch.js")).resolves.toHaveProperty("sendFetchRequests");
    await expect(import("../host-agent/host-fetch.js")).resolves.toHaveProperty("writeFetchRequest");
    await expect(import("../host-agent/host-channel-mark.js")).resolves.toHaveProperty("channelLive");
    await expect(import("../host-agent/host-attachment-source.js")).resolves.toHaveProperty("hostAttachmentSource");
    await expect(import("../host-agent/host-agent-launch.js")).resolves.toHaveProperty("startHostAgent");
    await expect(import("../host-agent/host-agent-cache.js")).resolves.toHaveProperty("hostCachePut");
    await expect(import("../host-agent/host-agent-input.js")).resolves.toHaveProperty("readBoundedInput");
    await expect(import("../host-agent/host-agent-prepare.js")).resolves.toHaveProperty("prepareHostThread");
    await expect(import("../host-agent/host-clone-update.js")).resolves.toHaveProperty("updateClone");
    await expect(import("../host-agent/host-run-events.js")).resolves.toHaveProperty("runEvents");
    await expect(import("../host-agent/host-run-state.js")).resolves.toHaveProperty("readHostRun");
    await expect(import("../host-agent/host-session-bytes.js")).resolves.toHaveProperty("hostSessionBytes");
    await expect(import("../host-agent/host-runner.js")).resolves.toHaveProperty("createHostRunner");
    await expect(import("../host-agent/host-checks.js")).resolves.toHaveProperty("openHostChecks");
    await expect(import("../check-queue/thread-checks.js")).resolves.toHaveProperty("withCheck");
    await expect(import("../thread-copy/thread-copy.js")).resolves.toHaveProperty("buildThreadCopy");
  });

  it("imports the host project service without loading Pi", async () => {
    await expect(import("../host-project/host-project.js")).resolves.toHaveProperty("useHost");
    await expect(import("../host-project/host-clone.js")).resolves.toHaveProperty("cloneStatus");
    await expect(import("../host-project/host-paths.js")).resolves.toHaveProperty("managedClonePath");
    await expect(import("../host-project/repo-url.js")).resolves.toHaveProperty("sameRepository");
    await expect(import("../host-project/local-origin.js")).resolves.toHaveProperty("localOrigin");
    await expect(import("../host-project/host-project-errors.js")).resolves.toHaveProperty("HostGitAccessError");
    await expect(import("../host/host-threads.js")).resolves.toHaveProperty("activeThreadsIn");
    await expect(import("../host-project/host-rows.js")).resolves.toHaveProperty("hostRows");
    await expect(import("../host/host-last-check.js")).resolves.toHaveProperty("recordLastCheck");
    await expect(import("../host/host.js")).resolves.toHaveProperty("updateHost");
  });

  it("imports the TUI without loading Pi", async () => {
    await expect(import("../../tui/app.js")).resolves.toHaveProperty("App");
  });
});
