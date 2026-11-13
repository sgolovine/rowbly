import { mkdir, readdir, readFile, stat, symlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { useTempDir } from "../testProject/testProject.js";
import { canCreateFolder, listMarkdownFiles, pathExists, pathOccupied, writeFileAtomic } from "./files.js";

describe("files", () => {
  const dir = useTempDir();

  it("pathExists tells if a path exists", async () => {
    expect(await pathExists(dir.path)).toBe(true);
    expect(await pathExists(join(dir.path, "nope"))).toBe(false);
  });

  it("pathOccupied also counts a broken symlink and a file in place of a parent folder", async () => {
    expect(await pathOccupied(dir.path)).toBe(true);
    expect(await pathOccupied(join(dir.path, "nope"))).toBe(false);
    await symlink("missing", join(dir.path, "link"));
    expect(await pathExists(join(dir.path, "link"))).toBe(false);
    expect(await pathOccupied(join(dir.path, "link"))).toBe(true);
    await writeFile(join(dir.path, "file"), "");
    expect(await pathOccupied(join(dir.path, "file", "child"))).toBe(true);
  });

  it("canCreateFolder is true for a folder and for a path below a folder", async () => {
    expect(await canCreateFolder(dir.path)).toBe(true);
    expect(await canCreateFolder(join(dir.path, "a", "b"))).toBe(true);
    await mkdir(join(dir.path, "real"));
    await symlink("real", join(dir.path, "link"));
    expect(await canCreateFolder(join(dir.path, "link", "child"))).toBe(true);
  });

  it("canCreateFolder is false when a file or a broken symlink is in the way", async () => {
    await writeFile(join(dir.path, "file"), "");
    expect(await canCreateFolder(join(dir.path, "file"))).toBe(false);
    expect(await canCreateFolder(join(dir.path, "file", "a", "b"))).toBe(false);
    await symlink("missing", join(dir.path, "broken"));
    expect(await canCreateFolder(join(dir.path, "broken"))).toBe(false);
    expect(await canCreateFolder(join(dir.path, "broken", "a"))).toBe(false);
    await symlink("file", join(dir.path, "to-file"));
    expect(await canCreateFolder(join(dir.path, "to-file"))).toBe(false);
  });

  it("listMarkdownFiles lists only .md files, sorted", async () => {
    await writeFile(join(dir.path, "b.md"), "");
    await writeFile(join(dir.path, "a.md"), "");
    await writeFile(join(dir.path, "c.txt"), "");
    await mkdir(join(dir.path, "d.md"));
    expect(await listMarkdownFiles(dir.path)).toEqual(["a.md", "b.md"]);
  });

  it("listMarkdownFiles returns none for a missing folder", async () => {
    expect(await listMarkdownFiles(join(dir.path, "missing"))).toEqual([]);
  });

  it("writeFileAtomic creates parent folders and leaves no temporary file", async () => {
    const path = join(dir.path, "x", "y", "file.txt");
    await writeFileAtomic(path, "hello");
    expect(await readFile(path, "utf8")).toBe("hello");
    expect(await readdir(join(dir.path, "x", "y"))).toEqual(["file.txt"]);
  });
  it("atomic writes do not collide and retain private mode", async () => {
    const path = join(dir.path, "shared");
    const values = Array.from({ length: 40 }, (_, index) => String(index).repeat(1000));
    await Promise.all(values.map((value) => writeFileAtomic(path, value, { mode: 0o600, durable: true })));
    expect(values).toContain(await readFile(path, "utf8"));
    expect((await stat(path)).mode & 0o777).toBe(0o600);
    expect(await readdir(dir.path)).toEqual(["shared"]);
  });
  it("removes temporary files after a failed rename", async () => {
    const path = join(dir.path, "folder");
    await mkdir(path);
    await expect(writeFileAtomic(path, "fail")).rejects.toThrow();
    expect(await readdir(dir.path)).toEqual(["folder"]);
  });
});
