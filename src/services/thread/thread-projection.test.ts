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
      result,
    });
    expect(attempts[0]?.stoppedAt).toEqual(expect.any(String));
  });
});
