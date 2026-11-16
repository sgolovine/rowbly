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

  it("imports the worker executor interface without loading Pi", async () => {
    await expect(import("../factory-manager/worker-executor.js")).resolves.toHaveProperty("workerControl");
  });

  it("imports the host transport without loading Pi", async () => {
    await expect(import("../host-transport/host-transport.js")).resolves.toHaveProperty("HOST_PROTOCOL_VERSION", 1);
    await expect(import("../host-transport/host-handshake.js")).resolves.toHaveProperty("openHostChannel");
    await expect(import("../host-transport/host-errors.js")).resolves.toHaveProperty("classifySshExit");
    await expect(import("../host-transport/json-lines.js")).resolves.toHaveProperty("decodeChunk");
    await expect(import("../host-transport/ssh-transport.js")).resolves.toHaveProperty("createSshTransport");
    await expect(import("../host-transport/ssh-process.js")).resolves.toHaveProperty("runSshCall");
    await expect(import("../host-transport/ssh-channel.js")).resolves.toHaveProperty("startSshChannel");
    await expect(import("../test-project/fake-host-transport.js")).resolves.toHaveProperty("createFakeHostTransport");
  });

  it("imports the outbox apply and the host outbox commands without loading Pi", async () => {
    await expect(import("../outbox/outbox-compare.js")).resolves.toHaveProperty("compareChange");
    await expect(import("../outbox/outbox-host.js")).resolves.toHaveProperty("hostOutboxEntries");
    await expect(import("../outbox-apply/outbox-apply.js")).resolves.toHaveProperty("syncOutbox");
    await expect(import("../outbox-apply/outbox-source.js")).resolves.toHaveProperty("transportOutboxSource");
    await expect(import("../outbox-apply/host-files.js")).resolves.toHaveProperty("readAppliedSeq");
    await expect(import("../factory-manager/outbox-attention.js")).resolves.toHaveProperty("syncHostOutbox");
  });

  it("imports the TUI without loading Pi", async () => {
    await expect(import("../../tui/app.js")).resolves.toHaveProperty("App");
  });
});
