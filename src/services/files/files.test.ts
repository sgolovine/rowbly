import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { useTempDir } from "../testProject/testProject.js";
import { listMarkdownFiles, pathExists, writeFileAtomic } from "./files.js";

describe("files", () => {
  const dir = useTempDir();

  it("pathExists tells if a path exists", async () => {
    expect(await pathExists(dir.path)).toBe(true);
    expect(await pathExists(join(dir.path, "nope"))).toBe(false);
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
});
