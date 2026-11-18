import { describe, expect, it } from "vitest";
import { readFactoryState } from "../factory-state/factory-state.js";
import { useTestProject } from "../test-project/test-project.js";
import { createThread, transitionThread } from "./thread-change.js";
import { getThread } from "./thread-files.js";
import { projectAttempts, projectNativeAttempt } from "./thread-projection.js";

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

  it("gives the same attempts in one batch as one projection for each Thread", async () => {
    const base = { role: "worker" as const, stage: "DEVELOP", cwd: p.paths.root, ownerToken: "owner" };
    const first = await createThread({ ...base, storyId: "ROW-1" }, p.ctx);
    const second = await createThread({ ...base, storyId: "ROW-2", model: { provider: "p", modelId: "m" } }, p.ctx);
    const supervisor = await createThread({ role: "supervisor", cwd: p.paths.root, ownerToken: "owner" }, p.ctx);
    const ids = [first.id, second.id, supervisor.id];

    await projectNativeAttempt(first.id, p.ctx);
    await transitionThread(first.id, { expectedRevision: 1, status: "running" }, p.ctx);

    const before = await readFactoryState(p.paths.root, p.ctx);
    const threads = await Promise.all(ids.map((id) => getThread(id, p.ctx)));
    const batch = projectAttempts(before, threads);

    for (const id of ids) await projectNativeAttempt(id, p.ctx);

    const single = await readFactoryState(p.paths.root, p.ctx);

    expect(batch.changed).toBe(true);
    expect(batch.state.attempts).toEqual(single.attempts);
    expect(single.attempts.map((a) => [a.threadId, a.status])).toEqual([
      [first.id, "running"],
      [second.id, "preparing"],
    ]);
  });

  it("reports no change when each attempt already follows its Thread", async () => {
    const t = await createThread(
      { role: "worker", storyId: "ROW-1", stage: "DEVELOP", cwd: p.paths.root, ownerToken: "owner" },
      p.ctx,
    );

    await projectNativeAttempt(t.id, p.ctx);

    const state = await readFactoryState(p.paths.root, p.ctx);
    const result = projectAttempts(state, [await getThread(t.id, p.ctx)]);

    expect("model" in (state.attempts[0] ?? {})).toBe(false);
    expect(result.changed).toBe(false);
    expect(result.state).toBe(state);
  });
});
