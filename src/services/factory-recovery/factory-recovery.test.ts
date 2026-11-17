import { execFile } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { promisify } from "node:util";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { readCheckJobs, writeCheckJobs } from "../check-queue/check-records.js";
import type { CheckJob } from "../check-queue/check-types.js";
import { readStartTicks, spawnCheck } from "../check-queue/proc-readers.js";
import { acquireFactoryOwnership, newOwner } from "../factory-ownership/factory-ownership.js";
import { readFactoryState, updateFactoryState } from "../factory-state/factory-state.js";
import { prepareRuntime } from "../runtime-files/runtime-files.js";
import { createStory, updateStory } from "../story/story.js";
import { useTestProject } from "../test-project/test-project.js";
import { createThread, getThread, projectNativeAttempt, transitionThread } from "../thread/thread.js";
import { preflightFactory, recoverFactory } from "./factory-recovery.js";

const stateFile = vi.hoisted(() => ({ beforeTransaction: undefined as (() => Promise<void>) | undefined }));

vi.mock("../factory-state/state-file.js", async (importOriginal) => {
  const original = await importOriginal<typeof import("../factory-state/state-file.js")>();

  return {
    ...original,
    writeState: vi.fn(original.writeState),
    withStateLock: vi.fn(async <T>(root: string, action: () => Promise<T>) => {
      await stateFile.beforeTransaction?.();
      return original.withStateLock(root, action);
    }),
  };
});

const { writeState } = await import("../factory-state/state-file.js");

beforeEach(() => {
  stateFile.beforeTransaction = undefined;
});

async function changeOwnerToken(runtimeDir: string): Promise<void> {
  const path = join(runtimeDir, "factory.lock");
  const owner = JSON.parse(await readFile(path, "utf8"));
  await writeFile(path, JSON.stringify({ ...owner, token: "other-owner" }));
}

describe("factory recovery", () => {
  const project = useTestProject();
  it.runIf(process.platform === "linux")("stops the orphan check processes of a dead owner", async () => {
    const owner = await newOwner();
    await acquireFactoryOwnership(project.paths, owner);
    await prepareRuntime(project.paths);
    const child = spawnCheck("sleep 60 & sleep 60; wait", { cwd: project.paths.root, env: process.env });
    const pid = child.pid as number;
    const startTicks = await readStartTicks(pid);
    const job = { id: "orphan", ownerToken: "dead", key: "test", status: "running", pgid: pid, startTicks };
    await writeCheckJobs(project.paths, [job as CheckJob], []);

    await recoverFactory(owner.token, "dead", false, project.ctx);

    expect(await child.exited).toBeNull();
    expect(await readStartTicks(pid)).toBeUndefined();
    expect((await readCheckJobs(project.paths))[0]?.status).toBe("cancelled");
  });
  it.each(["intent", "preparing", "worktree", "session"])(
    "recovers a crash after %s without duplicate attempts",
    async (boundary) => {
      const owner = await newOwner();
      await acquireFactoryOwnership(project.paths, owner);
      const story = await createStory({ title: "Recover", stage: "BACKLOG" }, project.ctx);
      let t = await createThread(
        { role: "worker", storyId: story.id, stage: story.stage, ownerToken: "dead", cwd: project.paths.root },
        project.ctx,
      );
      if (boundary !== "intent") await projectNativeAttempt(t.id, project.ctx);
      if (["worktree", "session"].includes(boundary)) {
        const worktree = join(project.paths.root, "preserved worktree");
        await mkdir(worktree);
        await writeFile(join(worktree, "dirty.txt"), "keep");
        t = await transitionThread(
          t.id,
          { expectedRevision: t.revision, status: "pending", patch: { worktree } },
          project.ctx,
        );
      }
      if (boundary === "session") {
        const file = `sessions/${t.id}/pi.jsonl`;
        await mkdir(join(project.paths.runtimeDir, `sessions/${t.id}`));
        await writeFile(join(project.paths.runtimeDir, file), '{"type":"session","version":3}\n');
        t = await transitionThread(
          t.id,
          { expectedRevision: t.revision, status: "pending", patch: { session: { id: t.id, file } } },
          project.ctx,
        );
      }
      await recoverFactory(owner.token, "dead", false, project.ctx);
      await recoverFactory(owner.token, "dead", false, project.ctx);
      const recovered = await getThread(t.id, project.ctx);
      expect(recovered.status).toBe("interrupted");
      expect(recovered.resumable).toBe(boundary === "session");
      expect((await readFactoryState(project.paths.root)).attempts).toHaveLength(1);
      expect(recovered.worktree).toBe(t.worktree);
      if (boundary === "session") {
        await updateStory({ id: story.id, stage: "DONE" }, project.ctx);
        // A later resume must also check the current Stage; recovery does not activate a session.
      }
    },
  );
  it.runIf(process.platform === "linux")("refuses the preflight while an old factory.json exists", async () => {
    await promisify(execFile)("git", ["init", project.paths.root]);
    await expect(preflightFactory(project.ctx)).resolves.toBeUndefined();
    await project.write("factory.json", "{ not parsed");
    await expect(preflightFactory(project.ctx)).rejects.toMatchObject({
      code: "CONFLICT",
      hint: expect.stringContaining("rowbly doctor --fix"),
    });
  });
  it("interrupts a local worker of a dead owner, and keeps an active worker on a worker host", async () => {
    const owner = await newOwner();
    await acquireFactoryOwnership(project.paths, owner);
    const local = await createThread(
      { role: "worker", storyId: "ROW-1", stage: "BACKLOG", ownerToken: "dead", cwd: project.paths.root },
      project.ctx,
    );
    await transitionThread(local.id, { expectedRevision: local.revision, status: "running" }, project.ctx);
    const remote = await createThread(
      { role: "worker", storyId: "ROW-2", stage: "BACKLOG", ownerToken: "dead", cwd: project.paths.root, host: "mini" },
      project.ctx,
    );
    await transitionThread(remote.id, { expectedRevision: remote.revision, status: "running" }, project.ctx);
    const pending = await createThread(
      { role: "worker", storyId: "ROW-3", stage: "BACKLOG", ownerToken: "dead", cwd: project.paths.root, host: "mini" },
      project.ctx,
    );

    await recoverFactory(owner.token, "dead", false, project.ctx);

    expect(await getThread(local.id, project.ctx)).toMatchObject({
      status: "interrupted",
      error: { code: "OWNER_DIED" },
    });
    const running = await getThread(remote.id, project.ctx);
    expect(running.status).toBe("running");
    expect(running.error).toBeUndefined();
    const waiting = await getThread(pending.id, project.ctx);
    expect(waiting.status).toBe("pending");
    expect(waiting.error).toBeUndefined();
    // The projection of the remote Threads is repaired.
    const attempts = (await readFactoryState(project.paths.root)).attempts;
    expect(attempts.find((a) => a.threadId === remote.id)?.status).toBe("running");
    expect(attempts.find((a) => a.threadId === pending.id)).toBeDefined();
  });
  it("preserves external attempts unless adoption is explicit", async () => {
    const owner = await newOwner();
    await acquireFactoryOwnership(project.paths, owner);
    await updateFactoryState(project.paths.root, (state) => ({
      ...state,
      attempts: [{ story: "ROW-01", stage: "BACKLOG", workerId: "external", status: "running" }],
    }));
    expect((await recoverFactory(owner.token, "dead", false, project.ctx)).externalActive).toBe(1);
    expect((await readFactoryState(project.paths.root)).attempts[0]?.status).toBe("running");
    await recoverFactory(owner.token, "dead", true, project.ctx);
    expect((await readFactoryState(project.paths.root)).attempts[0]?.status).toBe("interrupted");
  });
  it("recovers A and B after B dies before recovery, but preserves the current owner", async () => {
    const owner = await newOwner();
    await acquireFactoryOwnership(project.paths, owner);
    const ids = [];
    for (const token of ["dead-A", "dead-B", owner.token]) {
      const t = await createThread({ role: "supervisor", ownerToken: token, cwd: project.paths.root }, project.ctx);
      await transitionThread(t.id, { expectedRevision: t.revision, status: "running" }, project.ctx);
      ids.push(t.id);
    }
    await recoverFactory(owner.token, "dead-B", false, project.ctx);
    expect(await Promise.all(ids.map(async (id) => (await getThread(id, project.ctx)).status))).toEqual([
      "interrupted",
      "interrupted",
      "running",
    ]);
  });
  it("finishes partial recovery across generations and repairs projections idempotently", async () => {
    const owner = await newOwner();
    await acquireFactoryOwnership(project.paths, owner);
    const ids = [];
    for (const [index, token] of ["dead-A", "dead-A", "dead-B"].entries()) {
      const t = await createThread(
        { role: "worker", storyId: `ROW-${index + 1}`, stage: "BACKLOG", ownerToken: token, cwd: project.paths.root },
        project.ctx,
      );
      await transitionThread(t.id, { expectedRevision: t.revision, status: "running" }, project.ctx);
      await projectNativeAttempt(t.id, project.ctx);
      ids.push(t.id);
    }
    // B persisted one interruption, then died before its state projection.
    await transitionThread(ids[0], { expectedRevision: 2, status: "interrupted" }, project.ctx);
    await recoverFactory(owner.token, "dead-B", false, project.ctx);
    const recovered = await Promise.all(ids.map((id) => getThread(id, project.ctx)));
    await recoverFactory(owner.token, "dead-B", false, project.ctx);
    expect(await Promise.all(ids.map((id) => getThread(id, project.ctx)))).toEqual(recovered);
    expect(recovered.every((t) => t.status === "interrupted")).toBe(true);
    const state = await readFactoryState(project.paths.root);
    expect(state.attempts).toHaveLength(3);
    expect(state.attempts.every((a) => a.status === "interrupted")).toBe(true);
  });
  it("recovers many worker Threads with one state write, and writes nothing when no attempt changes", async () => {
    const owner = await newOwner();
    await acquireFactoryOwnership(project.paths, owner);
    for (let index = 0; index < 24; index++) {
      const t = await createThread(
        { role: "worker", storyId: `ROW-${index}`, stage: "BACKLOG", ownerToken: "dead", cwd: project.paths.root },
        project.ctx,
      );
      await transitionThread(t.id, { expectedRevision: t.revision, status: "running" }, project.ctx);
    }
    vi.mocked(writeState).mockClear();

    await recoverFactory(owner.token, "dead", false, project.ctx);

    expect(writeState).toHaveBeenCalledTimes(1);
    const first = await readFactoryState(project.paths.root);
    expect(first.attempts).toHaveLength(24);
    expect(first.attempts.every((a) => a.status === "interrupted")).toBe(true);
    vi.mocked(writeState).mockClear();

    await recoverFactory(owner.token, "dead", false, project.ctx);

    expect(writeState).not.toHaveBeenCalled();
    expect((await readFactoryState(project.paths.root)).updatedAt).toBe(first.updatedAt);
  });
  it("recovers a mix of Threads into one attempt for each worker Thread", async () => {
    const owner = await newOwner();
    await acquireFactoryOwnership(project.paths, owner);
    const worker = { role: "worker" as const, stage: "BACKLOG", ownerToken: "dead", cwd: project.paths.root };
    const active = await createThread({ ...worker, storyId: "ROW-1" }, project.ctx);
    await transitionThread(active.id, { expectedRevision: active.revision, status: "running" }, project.ctx);
    const done = await createThread({ ...worker, storyId: "ROW-2" }, project.ctx);
    await transitionThread(done.id, { expectedRevision: done.revision, status: "running" }, project.ctx);
    await transitionThread(done.id, { expectedRevision: done.revision + 1, status: "completed" }, project.ctx);
    await projectNativeAttempt(done.id, project.ctx);
    const remote = await createThread({ ...worker, storyId: "ROW-3", host: "mini" }, project.ctx);
    await transitionThread(remote.id, { expectedRevision: remote.revision, status: "running" }, project.ctx);
    const waiting = await createThread({ ...worker, storyId: "ROW-4", host: "mini" }, project.ctx);
    const supervisor = await createThread(
      { role: "supervisor", ownerToken: "dead", cwd: project.paths.root },
      project.ctx,
    );
    vi.mocked(writeState).mockClear();

    await recoverFactory(owner.token, "dead", false, project.ctx);

    expect(writeState).toHaveBeenCalledTimes(1);
    const { attempts } = await readFactoryState(project.paths.root);
    expect(attempts.map((a) => [a.threadId, a.story, a.status])).toEqual([
      [done.id, "ROW-2", "completed"],
      [active.id, "ROW-1", "interrupted"],
      [remote.id, "ROW-3", "running"],
      [waiting.id, "ROW-4", "preparing"],
    ]);
    expect(attempts.some((a) => a.threadId === supervisor.id)).toBe(false);
    expect((await getThread(remote.id, project.ctx)).status).toBe("running");
    expect((await getThread(waiting.id, project.ctx)).status).toBe("pending");
  });
  it("refuses the batch write when the owner token changes before it", async () => {
    const owner = await newOwner();
    await acquireFactoryOwnership(project.paths, owner);
    // A Thread on a worker host is not interrupted, so the batch write is the only state transaction.
    await createThread(
      { role: "worker", storyId: "ROW-1", stage: "BACKLOG", ownerToken: "dead", cwd: project.paths.root, host: "mini" },
      project.ctx,
    );
    stateFile.beforeTransaction = () => changeOwnerToken(project.paths.runtimeDir);
    vi.mocked(writeState).mockClear();

    await expect(recoverFactory(owner.token, "dead", false, project.ctx)).rejects.toMatchObject({
      code: "CONFLICT",
      message: "Factory owner token changed",
    });
    expect(writeState).not.toHaveBeenCalled();
    expect((await readFactoryState(project.paths.root)).attempts).toEqual([]);
  });
});
