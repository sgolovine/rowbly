import * as fs from "node:fs/promises";
import { mkdir, rename, symlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { ValidationError } from "../errors/errors.js";
import { useTestProject } from "../test-project/test-project.js";
import { createThread } from "./thread-change.js";
import { saveThread } from "./thread-files.js";
import { listThreads } from "./thread-list.js";

vi.mock("node:fs/promises", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs/promises")>();
  return { ...actual, lstat: vi.fn(actual.lstat), realpath: vi.fn(actual.realpath) };
});

describe("thread list path checks", () => {
  const p = useTestProject();

  async function addThreads(count: number, offset = 0) {
    return Promise.all(
      Array.from({ length: count }, async (_, index) => {
        const id = `t${offset + index}`;
        const t = await createThread({ id, role: "supervisor", cwd: p.paths.root, ownerToken: "owner" }, p.ctx);
        const file = `sessions/${id}/s.jsonl`;
        await mkdir(join(p.paths.runtimeDir, "sessions", id), { recursive: true });
        await writeFile(join(p.paths.runtimeDir, file), "");
        return saveThread({ ...t, session: { id, file } }, p.ctx);
      }),
    );
  }

  async function countedList() {
    vi.mocked(fs.lstat).mockClear();
    vi.mocked(fs.realpath).mockClear();
    const list = await listThreads({}, p.ctx);
    return { list, lstat: vi.mocked(fs.lstat).mock.calls.length, realpath: vi.mocked(fs.realpath).mock.calls.length };
  }

  it("checks the shared folders one time and each Thread with at most 3 lstat calls", async () => {
    await addThreads(1);
    const one = await countedList();
    await addThreads(4, 1);
    const five = await countedList();

    expect(one.list.threads).toHaveLength(1);
    expect(five.list.threads).toHaveLength(5);
    expect(five.list.issues).toEqual([]);
    expect(five.realpath).toBe(one.realpath);
    expect(five.lstat - one.lstat).toBeLessThanOrEqual(3 * 4);
    expect(one.lstat - 3).toBe(five.lstat - 15);
  });

  it("gives an issue for a symlink at a Thread file, a session folder or a session file", async () => {
    await addThreads(3);
    const outside = join(p.paths.root, "outside");
    await mkdir(outside);
    const threads = join(p.paths.runtimeDir, "threads");
    const sessions = join(p.paths.runtimeDir, "sessions");

    await rename(join(threads, "t0.json"), join(outside, "t0.json"));
    await symlink(join(outside, "t0.json"), join(threads, "t0.json"));
    await rename(join(sessions, "t1"), join(outside, "t1"));
    await symlink(join(outside, "t1"), join(sessions, "t1"));
    await rename(join(sessions, "t2/s.jsonl"), join(outside, "s.jsonl"));
    await symlink(join(outside, "s.jsonl"), join(sessions, "t2/s.jsonl"));

    const list = await listThreads({}, p.ctx);

    expect(list.threads).toEqual([]);
    expect(list.issues.map((issue) => issue.file)).toEqual(["threads/t0.json", "threads/t1.json", "threads/t2.json"]);
    expect(list.issues.every((issue) => /symlink/.test(issue.message))).toBe(true);
  });

  it("gives an issue for a symlink in the session path of a cached Thread on the next list", async () => {
    await addThreads(2);
    const outside = join(p.paths.root, "outside");
    await mkdir(outside);
    const sessions = join(p.paths.runtimeDir, "sessions");

    expect((await listThreads({}, p.ctx)).threads).toHaveLength(2);

    await rename(join(sessions, "t0"), join(outside, "t0"));
    await symlink(join(outside, "t0"), join(sessions, "t0"));
    await rename(join(sessions, "t1/s.jsonl"), join(outside, "s.jsonl"));
    await symlink(join(outside, "s.jsonl"), join(sessions, "t1/s.jsonl"));

    const list = await listThreads({}, p.ctx);

    expect(list.threads).toEqual([]);
    expect(list.issues.map((issue) => issue.file)).toEqual(["threads/t0.json", "threads/t1.json"]);
    expect(list.issues.every((issue) => /symlink/.test(issue.message))).toBe(true);
  });

  it.each(["", "threads", "sessions"])("fails for a symlink at the runtime folder %j", async (name) => {
    await addThreads(1);
    const target = join(p.paths.runtimeDir, name);
    const moved = join(p.paths.root, "moved");
    await rename(target, moved);
    await symlink(moved, target);

    const error = await listThreads({}, p.ctx).catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(ValidationError);
    expect((error as Error).message).toMatch(/symlink/);
  });
});
