import { execFile } from "node:child_process";
import { mkdir, readFile, stat, symlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { promisify } from "node:util";
import { describe, expect, it } from "vitest";
import { doctor } from "../doctor/doctor.js";
import { useTestProject } from "../test-project/test-project.js";
import { ensureRuntimeIgnores, prepareRuntime, runtimePath } from "./runtime-files.js";

describe("runtime files", () => {
  const project = useTestProject();
  it("init creates ignore rules and doctor preserves user text on repair", async () => {
    expect(await readFile(project.paths.ignoreFile, "utf8")).toBe("/state.json*\n/runtime/\n");
    await writeFile(project.paths.ignoreFile, "# user\n/custom\n/state.json*");
    expect((await doctor({}, project.ctx)).issues).toContainEqual(
      expect.objectContaining({ message: "Factory runtime ignore rules are missing", fixed: false }),
    );
    await doctor({ fix: true }, project.ctx);
    const expected = "# user\n/custom\n/state.json*\n/runtime/\n";
    expect(await readFile(project.paths.ignoreFile, "utf8")).toBe(expected);
    await ensureRuntimeIgnores(project.paths);
    expect(await readFile(project.paths.ignoreFile, "utf8")).toBe(expected);
  });
  it("creates private directories and rejects traversal and symlink escapes", async () => {
    await prepareRuntime(project.paths);
    expect((await stat(project.paths.runtimeDir)).mode & 0o777).toBe(0o700);
    expect(await runtimePath(project.paths, "threads/a.json")).toBe(join(project.paths.runtimeDir, "threads/a.json"));
    for (const ref of ["../state.json", "/tmp/a", ""]) await expect(runtimePath(project.paths, ref)).rejects.toThrow();
    await symlink(project.paths.storiesDir, join(project.paths.runtimeDir, "escape"));
    await expect(runtimePath(project.paths, "escape/a.json")).rejects.toThrow(/symlink/);
  });
  it("doctor warns about already tracked runtime files", async () => {
    await prepareRuntime(project.paths);
    await writeFile(join(project.paths.runtimeDir, "tracked.json"), "{}");
    await promisify(execFile)("git", ["init", project.paths.root]);
    await promisify(execFile)("git", ["-C", project.paths.root, "add", "-f", "--", ".rowbly/runtime/tracked.json"]);
    expect((await doctor({ fix: true }, project.ctx)).issues).toContainEqual(
      expect.objectContaining({
        message: "Factory runtime file is tracked by Git",
        fixed: false,
      }),
    );
  });
  it("rejects a symlink at the runtime root", async () => {
    await mkdir(join(project.paths.root, "outside"));
    await symlink(join(project.paths.root, "outside"), project.paths.runtimeDir);
    await expect(prepareRuntime(project.paths)).rejects.toThrow(/symlink/);
  });
});
