import { execFile } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { promisify } from "node:util";
import { describe, expect, it } from "vitest";
import { useTempDir } from "../test-project/test-project.js";
import { commitCanonicalProject, projectWrite, projectWriteLockPath } from "./project-write.js";

const run = promisify(execFile);
describe("projectWrite", () => {
  const dir = useTempDir();
  it("commits canonical files and excludes runtime under the shared lock", async () => {
    await run("git", ["init", dir.path]);
    await run("git", ["-C", dir.path, "config", "user.name", "Test"]);
    await run("git", ["-C", dir.path, "config", "user.email", "test@example.com"]);
    await mkdir(join(dir.path, ".rowbly/runtime"), { recursive: true });
    await writeFile(join(dir.path, ".rowbly/ROWBLY.md"), "# Instructions");
    await writeFile(join(dir.path, ".rowbly/runtime/private.json"), "{}");
    expect(await commitCanonicalProject(dir.path)).toMatchObject({ status: "committed" });
    const tracked = await run("git", ["-C", dir.path, "ls-files"]);
    expect(tracked.stdout).toBe(".rowbly/ROWBLY.md\n");
  });
  it("uses the external commit lock path and excludes worker writes", async () => {
    await run("git", ["init", dir.path]);
    const lock = await projectWriteLockPath(dir.path);
    expect(lock).toBe(`${dir.path}/.git/rowbly-project-write.lock`);
    await projectWrite(dir.path, async () => {
      await expect(run("flock", ["-n", lock, "true"])).rejects.toMatchObject({ code: 1 });
    });
    await expect(run("flock", ["-n", lock, "true"])).resolves.toBeDefined();
  });
  it("handles Project paths with spaces", async () => {
    const root = join(dir.path, "with spaces");
    await mkdir(root);
    await run("git", ["init", root]);
    await projectWrite(root, async () => {
      await expect(run("flock", ["-n", await projectWriteLockPath(root), "true"])).rejects.toMatchObject({ code: 1 });
    });
  });
  it("releases the kernel lock after callback failure", async () => {
    await expect(
      projectWrite(dir.path, async () => {
        throw new Error("callback");
      }),
    ).rejects.toThrow("callback");
    await expect(run("flock", ["-n", await projectWriteLockPath(dir.path), "true"])).resolves.toBeDefined();
  });
  it("does not run a callback after a lock timeout", async () => {
    let called = false;
    await projectWrite(dir.path, async () => {
      await expect(
        projectWrite(
          dir.path,
          async () => {
            called = true;
          },
          0.01,
        ),
      ).rejects.toMatchObject({ code: "CONFLICT" });
    });
    expect(called).toBe(false);
  });
});
