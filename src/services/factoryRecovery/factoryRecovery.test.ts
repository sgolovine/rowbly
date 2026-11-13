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
  it("quarantines active runs whose owner death is uncertain", async () => {
    const owner = await newOwner();
    await acquireFactoryOwnership(project.paths, owner);
    const t = await createThread({ role: "supervisor", ownerToken: "uncertain", cwd: project.paths.root }, project.ctx);
    await recoverFactory(owner.token, "dead", false, project.ctx);
    expect((await getThread(t.id, project.ctx)).status).toBe("pending");
  });
});
