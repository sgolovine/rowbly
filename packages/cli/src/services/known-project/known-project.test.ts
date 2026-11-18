import { lstat, mkdir, readFile, symlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { ValidationError } from "../errors/errors.js";
import { initProject } from "../project/project.js";
import { useTempDir } from "../test-project/test-project.js";
import { forgetProject, listKnownProjects, RC_FILE, recordProject } from "./known-project.js";

describe("known projects", () => {
  const dir = useTempDir();
  const ctx = () => ({ home: dir.path });
  const rcFile = () => join(dir.path, RC_FILE);
  const stored = async () => JSON.parse(await readFile(rcFile(), "utf8"));

  it("lists nothing, and creates no file, before a project is opened", async () => {
    expect(await listKnownProjects(ctx())).toEqual([]);
    await expect(lstat(rcFile())).rejects.toThrow();
  });

  it("keeps the most recent project first, with one entry for each path", async () => {
    await recordProject({ path: "/a", name: "A" }, ctx());
    await recordProject({ path: "/b", name: "B" }, ctx());
    await recordProject({ path: "/a", name: "A" }, ctx());
    expect((await listKnownProjects(ctx())).map((p) => p.path)).toEqual(["/a", "/b"]);
  });

  it("updates the name of a project that was renamed", async () => {
    await recordProject({ path: "/a", name: "A" }, ctx());
    await recordProject({ path: "/a", name: "Renamed" }, ctx());
    expect((await stored()).projects).toEqual([{ path: "/a", name: "Renamed" }]);
  });

  it("marks a project that is gone as missing", async () => {
    const root = join(dir.path, "here");
    await mkdir(root);
    await initProject({ name: "Here", key: "HR" }, { cwd: root });
    await recordProject({ path: join(dir.path, "gone"), name: "Gone" }, ctx());
    await recordProject({ path: root, name: "Here" }, ctx());
    expect((await listKnownProjects(ctx())).map((p) => [p.name, p.missing])).toEqual([
      ["Here", false],
      ["Gone", true],
    ]);
  });

  it("keeps the other keys of the file", async () => {
    await writeFile(rcFile(), JSON.stringify({ version: 1, me: "sunny", dataRoots: [{ path: "/old" }] }));
    await recordProject({ path: "/a", name: "A" }, ctx());
    expect(await stored()).toEqual({
      version: 1,
      me: "sunny",
      dataRoots: [{ path: "/old" }],
      projects: [{ path: "/a", name: "A" }],
    });
  });

  it("writes through a symbolic link and keeps the link", async () => {
    const real = join(dir.path, "dotfile.json");
    await writeFile(real, "{}");
    await symlink(real, rcFile());
    await recordProject({ path: "/a", name: "A" }, ctx());
    expect((await lstat(rcFile())).isSymbolicLink()).toBe(true);
    expect(JSON.parse(await readFile(real, "utf8")).projects).toHaveLength(1);
  });

  it("forgets a project and keeps the other projects and keys", async () => {
    await writeFile(rcFile(), JSON.stringify({ version: 1 }));
    await recordProject({ path: "/a", name: "A" }, ctx());
    await recordProject({ path: "/b", name: "B" }, ctx());
    await forgetProject("/a", ctx());
    expect(await stored()).toEqual({ version: 1, projects: [{ path: "/b", name: "B" }] });
  });

  it("writes nothing when it forgets a project that is not in the list", async () => {
    await forgetProject("/a", ctx());
    await expect(lstat(rcFile())).rejects.toThrow();
  });

  it.each([
    ["not JSON", "{ nope"],
    ["not an object", "[]"],
    ["projects that are not a list", '{"projects":3}'],
    ["an entry without a name", '{"projects":[{"path":"/a"}]}'],
  ])("rejects %s and leaves the file as it was", async (_, content) => {
    await writeFile(rcFile(), content);
    await expect(listKnownProjects(ctx())).rejects.toBeInstanceOf(ValidationError);
    await expect(recordProject({ path: "/a", name: "A" }, ctx())).rejects.toBeInstanceOf(ValidationError);
    await expect(forgetProject("/a", ctx())).rejects.toBeInstanceOf(ValidationError);
    expect(await readFile(rcFile(), "utf8")).toBe(content);
  });
});
