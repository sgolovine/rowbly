import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { useTestProject } from "../test-project/test-project.js";
import { createThread } from "./thread-change.js";
import { getThread, saveThread } from "./thread-files.js";

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

  it("refuses to save a session reference outside the Thread folder", async () => {
    const t = await createThread({ role: "supervisor", cwd: p.paths.root, ownerToken: "owner" }, p.ctx);

    await expect(saveThread({ ...t, session: { id: t.id, file: "sessions/other/x.jsonl" } }, p.ctx)).rejects.toThrow(
      "Invalid thread session reference",
    );
  });
});
