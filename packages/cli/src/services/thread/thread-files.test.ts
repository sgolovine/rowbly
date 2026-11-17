import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { useTestProject } from "../test-project/test-project.js";
import { createThread } from "./thread-change.js";
import { getThread, saveThread } from "./thread-files.js";
import { listThreads } from "./thread-list.js";

describe("thread files", () => {
  const p = useTestProject();

  it("reads saved metadata and reports missing, corrupt and mismatched files", async () => {
    const t = await createThread({ role: "supervisor", cwd: p.paths.root, ownerToken: "owner" }, p.ctx);

    expect(await getThread(t.id, p.ctx)).toEqual(t);
    await expect(getThread("absent", p.ctx)).rejects.toThrow("Thread absent not found");
    await expect(getThread("../x", p.ctx)).rejects.toThrow("Invalid thread ID");

    await writeFile(join(p.paths.runtimeDir, "threads/bad.json"), "{");
    await expect(getThread("bad", p.ctx)).rejects.toThrow("Invalid thread JSON: bad");

    await writeFile(join(p.paths.runtimeDir, "threads/copy.json"), JSON.stringify(t));
    await expect(getThread("copy", p.ctx)).rejects.toThrow("does not match");
  });

  it("reads an old Thread file without a host as local", async () => {
    const t = await createThread(
      { role: "worker", storyId: "ROW-1", stage: "DEVELOP", cwd: p.paths.root, ownerToken: "owner" },
      p.ctx,
    );
    const { host: _host, ...old } = t;

    await writeFile(join(p.paths.runtimeDir, `threads/${t.id}.json`), JSON.stringify(old));

    expect((await getThread(t.id, p.ctx)).host).toBe("local");
    expect((await listThreads({}, p.ctx)).threads.map((thread) => thread.host)).toEqual(["local"]);
  });

  it("keeps the recorded host of a Thread", async () => {
    const t = await createThread(
      { role: "worker", storyId: "ROW-1", stage: "DEVELOP", cwd: p.paths.root, ownerToken: "owner", host: "builder" },
      p.ctx,
    );

    expect((await getThread(t.id, p.ctx)).host).toBe("builder");
  });

  it("refuses to save a session reference outside the Thread folder", async () => {
    const t = await createThread({ role: "supervisor", cwd: p.paths.root, ownerToken: "owner" }, p.ctx);

    await expect(saveThread({ ...t, session: { id: t.id, file: "sessions/other/x.jsonl" } }, p.ctx)).rejects.toThrow(
      "Invalid thread session reference",
    );
  });
});
