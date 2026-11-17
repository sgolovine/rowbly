import { writeFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { acquireFactoryOwnership, newOwner } from "../../services/factory-ownership/factory-ownership.js";
import { prepareRuntime, runtimePath } from "../../services/runtime-files/runtime-files.js";
import { createStage } from "../../services/stage/stage.js";
import { createStory } from "../../services/story/story.js";
import { useTempDir, useTestProject } from "../../services/test-project/test-project.js";
import { createThread, transitionThread } from "../../services/thread/thread-change.js";
import { runCli } from "../test-cli/test-cli.js";

describe("status command", () => {
  const project = useTestProject();

  async function seed(): Promise<void> {
    await createStage({ label: "Paused", enabled: false, position: 2 }, project.ctx);
    await createStory({ title: "One" }, project.ctx);
    await createStory({ title: "Two" }, project.ctx);
    await createStory({ title: "Three", stage: "DONE" }, project.ctx);
    const thread = await createThread({ role: "supervisor", cwd: project.paths.root, ownerToken: "o" }, project.ctx);
    await transitionThread(thread.id, { expectedRevision: thread.revision, status: "running" }, project.ctx);
    await createThread(
      { role: "worker", storyId: "ROW-01", stage: "BACKLOG", cwd: project.paths.root, ownerToken: "o" },
      project.ctx,
    );
  }

  it("is listed in the help", async () => {
    const { stdout } = await runCli(["--help"], project.ctx.cwd);
    expect(stdout).toMatch(/status\s+Show a short summary of the project/);
  });

  it("prints a summary for a person", async () => {
    await seed();
    expect(await runCli(["status"], project.ctx.cwd)).toEqual({
      stdout: [
        "Factory: stopped",
        "Threads: 1 running, 1 pending",
        "",
        "Stories: 3",
        "  Backlog (BACKLOG)            2",
        "  Paused (PAUSED) (disabled)   0",
        "  Done (DONE)                  1",
      ].join("\n"),
      stderr: "",
      exitCode: 0,
    });
  });

  it("prints the same data as JSON", async () => {
    await seed();
    const result = await runCli(["--json", "status"], project.ctx.cwd);
    expect(result.exitCode).toBe(0);
    expect(JSON.parse(result.stdout)).toEqual({
      factory: { phase: "stopped" },
      threads: { running: 1, pending: 1 },
      stages: [
        { key: "BACKLOG", label: "Backlog", enabled: true, stories: 2 },
        { key: "PAUSED", label: "Paused", enabled: false, stories: 0 },
        { key: "DONE", label: "Done", enabled: true, stories: 1 },
      ],
      stories: 3,
    });
  });

  it("shows the remote Threads whose host lost its connection", async () => {
    const seen = new Date(Date.now() - 100_000).toISOString();
    const remote = await createThread(
      { role: "worker", storyId: "ROW-01", stage: "BACKLOG", cwd: project.paths.root, ownerToken: "o", host: "mini" },
      project.ctx,
    );
    await transitionThread(remote.id, { expectedRevision: remote.revision, status: "running" }, project.ctx);
    const blind = await createThread(
      { role: "worker", storyId: "ROW-02", stage: "BACKLOG", cwd: project.paths.root, ownerToken: "o", host: "gone" },
      project.ctx,
    );
    await prepareRuntime(project.paths);
    const owner = await newOwner();
    await acquireFactoryOwnership(project.paths, owner);
    const hosts = [
      { id: "local", state: "connected", max: 1, used: 0, free: 1 },
      { id: "mini", state: "disconnected", max: 1, used: 1, free: 0, lastSeenAt: seen, latencyMs: 20 },
    ];
    const status = { version: 1, phase: "ready", owner, heartbeatAt: new Date().toISOString(), hosts };
    await writeFile(await runtimePath(project.paths, "status.json"), JSON.stringify(status));

    const lines = (await runCli(["status"], project.ctx.cwd)).stdout.split("\n");
    expect(lines.slice(0, 4)).toEqual([
      "Factory: ready",
      "Threads: 1 running, 1 pending",
      expect.stringMatching(
        new RegExp(`^  ${remote.id} {2}ROW-01 {2}mini {2}connection lost \\(last contact 1m4\\ds ago\\)$`),
      ),
      `  ${blind.id}  ROW-02  gone  connection lost (no contact)`,
    ]);

    const json = JSON.parse((await runCli(["--json", "status"], project.ctx.cwd)).stdout);
    expect(json.connectionLost).toEqual([
      {
        threadId: remote.id,
        storyId: "ROW-01",
        host: "mini",
        hostState: "disconnected",
        lastSeenAt: seen,
        lastContactMs: expect.any(Number),
      },
      { threadId: blind.id, storyId: "ROW-02", host: "gone", hostState: "unknown" },
    ]);
  });

  it("gives zero Threads for a new Project", async () => {
    const result = await runCli(["status"], project.ctx.cwd);
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("Threads: 0 running, 0 pending");
  });
});

describe("status command without a Project", () => {
  const dir = useTempDir();

  it("fails with NOT_FOUND and exit code 1", async () => {
    const result = await runCli(["--json", "status"], dir.path);
    expect(result.exitCode).toBe(1);
    expect(JSON.parse(result.stderr).error.code).toBe("NOT_FOUND");
  });
});
