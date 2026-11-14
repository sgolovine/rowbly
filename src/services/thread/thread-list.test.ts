import * as fs from "node:fs/promises";
import { link, rename, rm, writeFile } from "node:fs/promises";
import { join, sep } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useTestProject } from "../test-project/test-project.js";
import { createThread, transitionThread } from "./thread-change.js";
import { saveThread } from "./thread-files.js";
import { listThreads } from "./thread-list.js";

vi.mock("node:fs/promises", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs/promises")>();
  return { ...actual, readFile: vi.fn(actual.readFile) };
});

/** Gives the Thread files that `readFile` read since the last reset. */
function threadReads(): string[] {
  return vi
    .mocked(fs.readFile)
    .mock.calls.map(([file]) => String(file))
    .filter((file) => file.includes(`${sep}threads${sep}`));
}

describe("thread list", () => {
  const p = useTestProject();

  it("gives no Threads before the first Thread exists", async () => {
    expect(await listThreads({}, p.ctx)).toEqual({ threads: [], issues: [] });
  });

  it("filters, sorts by creation time and reports unreadable files", async () => {
    const times = ["2026-11-13T00:00:02.000Z", "2026-11-13T00:00:01.000Z"];
    const [late, early] = await Promise.all(
      times.map((time, index) =>
        createThread(
          { id: `t${index}`, role: "supervisor", cwd: p.paths.root, ownerToken: "owner" },
          { ...p.ctx, now: () => new Date(time) },
        ),
      ),
    );
    await createThread(
      { role: "worker", storyId: "ROW-1", stage: "DEVELOP", cwd: p.paths.root, ownerToken: "owner" },
      p.ctx,
    );
    await writeFile(join(p.paths.runtimeDir, "threads/broken.json"), "{");

    const list = await listThreads({ role: "supervisor" }, p.ctx);

    expect(list.threads.map((t) => t.id)).toEqual([early.id, late.id]);
    expect(list.issues).toEqual([{ file: "threads/broken.json", message: "Invalid thread JSON: broken" }]);
    expect((await listThreads({ story: "ROW-1" }, p.ctx)).threads).toHaveLength(1);
    expect((await listThreads({ status: "running" }, p.ctx)).threads).toHaveLength(0);
  });

  describe("cache", () => {
    beforeEach(() => {
      vi.mocked(fs.readFile).mockClear();
    });

    async function threads(count: number) {
      const created = [];
      for (let index = 0; index < count; index += 1) {
        created.push(await createThread({ role: "supervisor", cwd: p.paths.root, ownerToken: "owner" }, p.ctx));
      }
      vi.mocked(fs.readFile).mockClear();
      return created;
    }

    it("reads each file one time and reads no file when nothing changed", async () => {
      await threads(3);

      expect((await listThreads({}, p.ctx)).threads).toHaveLength(3);
      expect(threadReads()).toHaveLength(3);

      vi.mocked(fs.readFile).mockClear();
      expect((await listThreads({}, p.ctx)).threads).toHaveLength(3);
      expect(threadReads()).toEqual([]);
    });

    it("reads only the changed Thread again and gives its new data", async () => {
      const [first, second] = await threads(3);
      await listThreads({}, p.ctx);

      await transitionThread(first.id, { expectedRevision: 1, status: "running" }, p.ctx);
      vi.mocked(fs.readFile).mockClear();
      const list = await listThreads({}, p.ctx);

      expect(threadReads()).toEqual([join(p.paths.runtimeDir, `threads/${first.id}.json`)]);
      expect(list.threads.find((t) => t.id === first.id)?.status).toBe("running");

      const renamed = { ...second, ownerToken: "other" };
      await saveThread(renamed, p.ctx);
      vi.mocked(fs.readFile).mockClear();

      expect((await listThreads({}, p.ctx)).threads.find((t) => t.id === second.id)).toEqual(renamed);
      expect(threadReads()).toEqual([join(p.paths.runtimeDir, `threads/${second.id}.json`)]);
    });

    it("shows a new Thread, drops a removed Thread and removes its cache entry", async () => {
      const [kept, removed] = await threads(2);
      const file = join(p.paths.runtimeDir, `threads/${removed.id}.json`);
      const spare = join(p.paths.runtimeDir, "spare");
      await listThreads({}, p.ctx);

      const added = await createThread({ role: "supervisor", cwd: p.paths.root, ownerToken: "owner" }, p.ctx);
      expect((await listThreads({}, p.ctx)).threads.map((t) => t.id).toSorted()).toEqual(
        [kept.id, removed.id, added.id].toSorted(),
      );

      // Keep the same inode, size and mtime with a hard link. Only a removed entry makes the next list read it.
      await link(file, spare);
      await rm(file);
      expect((await listThreads({}, p.ctx)).threads.map((t) => t.id)).not.toContain(removed.id);

      await rename(spare, file);
      vi.mocked(fs.readFile).mockClear();
      expect((await listThreads({}, p.ctx)).threads.map((t) => t.id)).toContain(removed.id);
      expect(threadReads()).toEqual([file]);
    });

    it("reports an invalid file on each list, does not cache it and returns it after a repair", async () => {
      const [t] = await threads(1);
      const file = join(p.paths.runtimeDir, `threads/${t.id}.json`);
      const issue = { file: `threads/${t.id}.json`, message: `Invalid thread JSON: ${t.id}` };
      await listThreads({}, p.ctx);

      await writeFile(file, "{");
      expect(await listThreads({}, p.ctx)).toEqual({ threads: [], issues: [issue] });
      vi.mocked(fs.readFile).mockClear();
      expect(await listThreads({}, p.ctx)).toEqual({ threads: [], issues: [issue] });
      expect(threadReads()).toEqual([file]);

      await writeFile(file, `${JSON.stringify(t)}\n`);
      expect(await listThreads({}, p.ctx)).toEqual({ threads: [t], issues: [] });
    });
  });

  describe("cache of a second Project", () => {
    const other = useTestProject();

    it("does not share entries between Projects", async () => {
      const t = await createThread({ id: "same", role: "supervisor", cwd: p.paths.root, ownerToken: "a" }, p.ctx);
      const u = await createThread(
        { id: "same", role: "supervisor", cwd: other.paths.root, ownerToken: "b" },
        other.ctx,
      );

      expect((await listThreads({}, p.ctx)).threads).toEqual([t]);
      expect((await listThreads({}, other.ctx)).threads).toEqual([u]);
      expect((await listThreads({}, p.ctx)).threads).toEqual([t]);
    });
  });
});
