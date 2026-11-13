import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { useTestProject } from "../test-project/test-project.js";
import { createThread } from "./thread-change.js";
import { listThreads } from "./thread-list.js";

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
});
