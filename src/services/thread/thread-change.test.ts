import { describe, expect, it } from "vitest";
import { useTestProject } from "../test-project/test-project.js";
import { appendThreadRun, createThread, transitionThread } from "./thread-change.js";

describe("thread change", () => {
  const p = useTestProject();
  const at = (time: string) => ({ ...p.ctx, now: () => new Date(time) });

  it("creates a pending Thread once", async () => {
    const t = await createThread({ id: "one", role: "supervisor", cwd: p.paths.root, ownerToken: "owner" }, p.ctx);

    expect(t).toMatchObject({ id: "one", revision: 1, status: "pending", session: { id: "one", file: null } });
    expect(t.runs).toMatchObject([{ ownerToken: "owner", status: "pending" }]);
    await expect(
      createThread({ id: "one", role: "supervisor", cwd: p.paths.root, ownerToken: "owner" }, p.ctx),
    ).rejects.toThrow("already exists");
  });

  it("records start and end times once, and clears the error on completion", async () => {
    const t = await createThread({ role: "supervisor", cwd: p.paths.root, ownerToken: "owner" }, p.ctx);
    const error = { class: "transient" as const, code: "X", message: "retry" };
    const running = await transitionThread(
      t.id,
      { expectedRevision: 1, status: "running", patch: { error } },
      at("2026-11-13T00:00:01.000Z"),
    );
    const again = await transitionThread(
      t.id,
      { expectedRevision: 2, status: "running" },
      at("2026-11-13T00:00:02.000Z"),
    );
    const done = await transitionThread(
      t.id,
      { expectedRevision: 3, status: "completed" },
      at("2026-11-13T00:00:03.000Z"),
    );

    expect(running).toMatchObject({ revision: 2, startedAt: "2026-11-13T00:00:01.000Z", error });
    expect(again.startedAt).toBe("2026-11-13T00:00:01.000Z");
    expect(done).toMatchObject({ revision: 4, completedAt: "2026-11-13T00:00:03.000Z" });
    expect(done).not.toHaveProperty("error");
    expect(done.runs[0]).toMatchObject({
      status: "completed",
      startedAt: "2026-11-13T00:00:01.000Z",
      endedAt: "2026-11-13T00:00:03.000Z",
    });
    await expect(transitionThread(t.id, { expectedRevision: 4, status: "running" }, p.ctx)).rejects.toThrow(
      "Invalid thread transition",
    );
  });

  it("reads, checks and saves under one lock, so that one of two concurrent changes wins", async () => {
    const input = { id: "same", role: "supervisor" as const, cwd: p.paths.root, ownerToken: "owner" };
    const creates = await Promise.allSettled([createThread(input, p.ctx), createThread(input, p.ctx)]);

    expect(creates.map((result) => result.status).toSorted()).toEqual(["fulfilled", "rejected"]);

    const moves = await Promise.allSettled([
      transitionThread("same", { expectedRevision: 1, status: "running" }, p.ctx),
      transitionThread("same", { expectedRevision: 1, status: "interrupted" }, p.ctx),
    ]);
    const failures = moves.flatMap((result) => (result.status === "rejected" ? [String(result.reason)] : []));

    expect(failures).toHaveLength(1);
    expect(failures[0]).toContain("Thread revision changed");
  });

  it("refuses to resume a Thread without a session file", async () => {
    const t = await createThread({ role: "supervisor", cwd: p.paths.root, ownerToken: "owner" }, p.ctx);

    await transitionThread(t.id, { expectedRevision: 1, status: "interrupted", patch: { resumable: true } }, p.ctx);
    await expect(appendThreadRun(t.id, { expectedRevision: 2, ownerToken: "next" }, p.ctx)).rejects.toThrow(
      "Thread cannot resume",
    );
  });
});
