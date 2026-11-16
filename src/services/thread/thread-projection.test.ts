import { describe, expect, it } from "vitest";
import { readFactoryState } from "../factory-state/factory-state.js";
import { useTestProject } from "../test-project/test-project.js";
import { createThread, transitionThread } from "./thread-change.js";
import { projectNativeAttempt } from "./thread-projection.js";

describe("thread projection", () => {
  const p = useTestProject();

  it("ignores a supervisor Thread", async () => {
    const t = await createThread({ role: "supervisor", cwd: p.paths.root, ownerToken: "owner" }, p.ctx);

    await projectNativeAttempt(t.id, p.ctx);
    expect((await readFactoryState(p.paths.root, p.ctx)).attempts).toEqual([]);
  });

  it("gives the attempt the storyUid of the worker Thread, and no storyUid for a Thread without one", async () => {
    const uid = "11111111-1111-4111-8111-111111111111";
    const base = { role: "worker" as const, stage: "DEVELOP", cwd: p.paths.root, ownerToken: "owner" };
    const withUid = await createThread({ ...base, storyId: "ROW-1", storyUid: uid }, p.ctx);
    const old = await createThread({ ...base, storyId: "ROW-2" }, p.ctx);

    await projectNativeAttempt(withUid.id, p.ctx);
    await projectNativeAttempt(old.id, p.ctx);

    const { attempts } = await readFactoryState(p.paths.root, p.ctx);

    expect(withUid.storyUid).toBe(uid);
    expect(attempts.map((attempt) => [attempt.story, attempt.storyUid])).toEqual([
      ["ROW-1", uid],
      ["ROW-2", undefined],
    ]);
    expect("storyUid" in (attempts[1] ?? {})).toBe(false);
  });

  it("follows the status, model and result of a worker Thread in one attempt", async () => {
    const t = await createThread(
      {
        role: "worker",
        storyId: "ROW-1",
        stage: "DEVELOP",
        cwd: p.paths.root,
        ownerToken: "owner",
        model: { provider: "p", modelId: "m" },
      },
      p.ctx,
    );
    const result = { outcome: "done", summary: "ok", blockers: [], problems: [] };

    await projectNativeAttempt(t.id, p.ctx);
    await transitionThread(t.id, { expectedRevision: 1, status: "cancelled", patch: { result } }, p.ctx);
    await projectNativeAttempt(t.id, p.ctx);

    const { attempts } = await readFactoryState(p.paths.root, p.ctx);

    expect(attempts).toHaveLength(1);
    expect(attempts[0]).toMatchObject({
      story: "ROW-1",
      stage: "DEVELOP",
      workerId: t.id,
      threadId: t.id,
      status: "interrupted",
      model: "p/m",
      host: "local",
      result,
    });
    expect(attempts[0]?.stoppedAt).toEqual(expect.any(String));
  });
});
