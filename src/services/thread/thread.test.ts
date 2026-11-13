import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { doctor } from "../doctor/doctor.js";
import { readFactoryState } from "../factoryState/factoryState.js";
import { useTestProject } from "../testProject/testProject.js";
import {
  appendThreadRun,
  createThread,
  getThread,
  listThreads,
  projectNativeAttempt,
  type ThreadStatus,
  transitionThread,
  watchThreads,
} from "./thread.js";

describe("thread", () => {
  const p = useTestProject();
  const create = () =>
    createThread(
      { role: "worker", storyId: "ROW-99", stage: "DEVELOP", cwd: p.paths.root, ownerToken: "owner" },
      p.ctx,
    );
  it("lists every status, isolates corrupt metadata and retains deleted Story history", async () => {
    for (const status of ["pending", "running", "completed", "failed", "cancelled", "interrupted"] as ThreadStatus[]) {
      const t = await create();
      if (status !== "pending") await transitionThread(t.id, { expectedRevision: 1, status }, p.ctx);
    }
    await writeFile(join(p.paths.runtimeDir, "threads/bad.json"), "{}");
    const list = await listThreads({ story: "ROW-99" }, p.ctx);
    expect(list.threads).toHaveLength(6);
    expect(list.issues).toHaveLength(1);
    expect((await doctor({}, p.ctx)).issues.filter((i) => i.file?.includes("runtime/threads/"))).toHaveLength(7);
  });
  it("resume preserves prior runs and rejects stale revisions", async () => {
    const t = await create();
    const file = `sessions/${t.id}/test.jsonl`;
    await mkdir(join(p.paths.runtimeDir, `sessions/${t.id}`), { recursive: true });
    await writeFile(join(p.paths.runtimeDir, file), "");
    await transitionThread(
      t.id,
      { expectedRevision: 1, status: "interrupted", patch: { session: { id: t.id, file }, resumable: true } },
      p.ctx,
    );
    const resumed = await appendThreadRun(t.id, { expectedRevision: 2, ownerToken: "new" }, p.ctx);
    expect(resumed.runs.map((r) => r.status)).toEqual(["interrupted", "pending"]);
    await expect(transitionThread(t.id, { expectedRevision: 2, status: "running" }, p.ctx)).rejects.toThrow("revision");
  });
  it("repairs pending intent projection idempotently and preserves unknown state keys", async () => {
    const t = await create();
    await projectNativeAttempt(t.id, p.ctx);
    await projectNativeAttempt(t.id, p.ctx);
    const state = await readFactoryState(p.paths.root, p.ctx);
    expect(state.attempts).toHaveLength(1);
    expect(state.attempts[0]).toMatchObject({ threadId: t.id, status: "preparing" });
    expect((await getThread(t.id, p.ctx)).session.file).toBeNull();
  });
  it("rejects escaping session references and immutable history transitions", async () => {
    const t = await create();
    await expect(
      transitionThread(
        t.id,
        { expectedRevision: 1, status: "running", patch: { session: { id: t.id, file: "../../escape.jsonl" } } },
        p.ctx,
      ),
    ).rejects.toThrow("reference");
    await transitionThread(t.id, { expectedRevision: 1, status: "failed" }, p.ctx);
    await expect(transitionThread(t.id, { expectedRevision: 2, status: "running" }, p.ctx)).rejects.toThrow(
      "transition",
    );
  });
  it("watches thread metadata, and factory status only on request, but not session histories", async () => {
    await create();
    const threads = vi.fn();
    const factory = vi.fn();
    const stops = [await watchThreads(threads, p.ctx), await watchThreads(factory, p.ctx, { factory: true })];
    try {
      await mkdir(join(p.paths.runtimeDir, "sessions/x"), { recursive: true });
      await writeFile(join(p.paths.runtimeDir, "sessions/x/history.jsonl"), "{}\n");
      await writeFile(join(p.paths.runtimeDir, "status.json"), "{}\n");
      await vi.waitFor(() => expect(factory).toHaveBeenCalled());
      expect(threads).not.toHaveBeenCalled();
      await create();
      await vi.waitFor(() => expect(threads).toHaveBeenCalled());
    } finally {
      for (const stop of stops) stop();
    }
  });
});
