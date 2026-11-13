import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { acquireFactoryOwnership, newOwner } from "../factoryOwnership/factoryOwnership.js";
import { readFactoryState, updateFactoryState } from "../factoryState/factoryState.js";
import { createStory, updateStory } from "../story/story.js";
import { useTestProject } from "../testProject/testProject.js";
import { createThread, getThread, projectNativeAttempt, transitionThread } from "../thread/thread.js";
import { recoverFactory } from "./factoryRecovery.js";

describe("factory recovery", () => {
  const project = useTestProject();
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
});
