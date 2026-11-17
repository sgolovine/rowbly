import { describe, expect, it, vi } from "vitest";
import { NotFoundError } from "../errors/errors.js";
import * as factory from "../factory/factory.js";
import { createStage } from "../stage/stage.js";
import { createStory } from "../story/story.js";
import { useTempDir, useTestProject } from "../test-project/test-project.js";
import { createThread, transitionThread } from "../thread/thread-change.js";
import { getProjectStatus } from "./project-status.js";

describe("project status", () => {
  const p = useTestProject();

  it("gives zero counts for a new Project with no runtime Threads", async () => {
    expect(await getProjectStatus(p.ctx)).toEqual({
      factory: { phase: "stopped" },
      threads: { running: 0, pending: 0 },
      stages: [
        { key: "BACKLOG", label: "Backlog", enabled: true, stories: 0 },
        { key: "DONE", label: "Done", enabled: true, stories: 0 },
      ],
      stories: 0,
    });
  });

  it("counts the Stories of each Stage in config order, also in a disabled Stage", async () => {
    await createStage({ label: "Paused", enabled: false, position: 2 }, p.ctx);
    await createStory({ title: "One" }, p.ctx);
    await createStory({ title: "Two" }, p.ctx);
    await createStory({ title: "Three", stage: "DONE" }, p.ctx);
    await createStory({ title: "Four", stage: "PAUSED" }, p.ctx);
    await p.write("stories/ROW-09.md", "---\ntitle: Lost\nstage: GONE\n---\n");

    const status = await getProjectStatus(p.ctx);

    expect(status.stages).toEqual([
      { key: "BACKLOG", label: "Backlog", enabled: true, stories: 2 },
      { key: "PAUSED", label: "Paused", enabled: false, stories: 1 },
      { key: "DONE", label: "Done", enabled: true, stories: 1 },
    ]);
    expect(status.stories).toBe(5);
  });

  it("counts the running and pending Threads of all roles", async () => {
    const supervisor = await createThread({ role: "supervisor", cwd: p.paths.root, ownerToken: "o" }, p.ctx);
    const worker = await createThread(
      { role: "worker", storyId: "ROW-01", stage: "BACKLOG", cwd: p.paths.root, ownerToken: "o" },
      p.ctx,
    );
    await createThread(
      { role: "worker", storyId: "ROW-02", stage: "BACKLOG", cwd: p.paths.root, ownerToken: "o" },
      p.ctx,
    );
    await transitionThread(supervisor.id, { expectedRevision: supervisor.revision, status: "running" }, p.ctx);
    await transitionThread(worker.id, { expectedRevision: worker.revision, status: "running" }, p.ctx);

    expect((await getProjectStatus(p.ctx)).threads).toEqual({ running: 2, pending: 1 });
  });

  it("lists the remote Threads whose host lost its connection in a live factory", async () => {
    const remote = await createThread(
      { role: "worker", storyId: "ROW-01", stage: "BACKLOG", cwd: p.paths.root, ownerToken: "o", host: "mini" },
      p.ctx,
    );
    const live = { version: 1, phase: "ready" as const, owner: { token: "t" } as never, liveness: "alive" as const };
    const hosts = [{ id: "mini", state: "version-mismatch" as const, max: 1, used: 1, free: 0 }];
    const spy = vi.spyOn(factory, "getFactoryStatus").mockResolvedValue({ ...live, hosts });

    try {
      expect((await getProjectStatus(p.ctx)).connectionLost).toEqual([
        { threadId: remote.id, storyId: "ROW-01", host: "mini", hostState: "version-mismatch" },
      ]);
      spy.mockResolvedValue({ ...live, liveness: "dead", hosts });
      expect(await getProjectStatus(p.ctx)).not.toHaveProperty("connectionLost");
    } finally {
      spy.mockRestore();
    }
  });

  it("does not fail when the factory status is unavailable", async () => {
    const spy = vi.spyOn(factory, "getFactoryStatus").mockResolvedValue({ version: 1, phase: "unavailable" });

    try {
      expect((await getProjectStatus(p.ctx)).factory).toEqual({ phase: "unavailable" });
    } finally {
      spy.mockRestore();
    }
  });
});

describe("project status without a Project", () => {
  const dir = useTempDir();

  it("gives NOT_FOUND", async () => {
    await expect(getProjectStatus({ cwd: dir.path })).rejects.toBeInstanceOf(NotFoundError);
  });
});
