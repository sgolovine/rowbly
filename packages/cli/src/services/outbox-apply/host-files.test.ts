import { readFile, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { useTestProject } from "../test-project/test-project.js";
import { readCopyBase, writeCopyBase } from "./host-files.js";

describe("writeCopyBase", () => {
  const project = useTestProject();

  it("writes the copy of the Thread with mode 0600 in folders with mode 0700, and replaces it on a later send", async () => {
    const copy = {
      files: [{ path: ".rowbly/config.json", content: "{}\n" }],
      attachments: [{ storyId: "TST-1", id: "a1", file: "a1.png" }],
    };

    const file = await writeCopyBase(project.paths, "mini", "t1", copy);

    const hostDir = join(project.paths.runtimeDir, "hosts", "mini");
    expect(file).toBe(join(hostDir, "threads", "t1", "base.json"));
    expect(JSON.parse(await readFile(file, "utf8"))).toEqual({
      version: 1,
      threadId: "t1",
      host: "mini",
      sentAt: expect.any(String),
      ...copy,
    });
    expect((await stat(file)).mode & 0o777).toBe(0o600);
    for (const dir of [join(project.paths.runtimeDir, "hosts"), hostDir, join(hostDir, "threads"), join(file, "..")]) {
      expect((await stat(dir)).mode & 0o777).toBe(0o700);
    }

    await writeCopyBase(project.paths, "mini", "t1", { files: [], attachments: [] });
    expect(JSON.parse(await readFile(file, "utf8"))).toMatchObject({ files: [], attachments: [] });
  });

  it("refuses a bad host id or Thread id before it writes a file", async () => {
    await expect(writeCopyBase(project.paths, "../x", "t1", { files: [], attachments: [] })).rejects.toMatchObject({
      code: "VALIDATION",
    });
    await expect(writeCopyBase(project.paths, "mini", "../t", { files: [], attachments: [] })).rejects.toMatchObject({
      code: "VALIDATION",
    });
  });
});

describe("readCopyBase", () => {
  const project = useTestProject();

  it("gives the base that writeCopyBase wrote, and undefined for a missing or bad file", async () => {
    const copy = { files: [{ path: ".rowbly/a.md", content: "a\n" }], attachments: [] };

    expect(await readCopyBase(project.paths, "mini", "t1")).toBeUndefined();
    const file = await writeCopyBase(project.paths, "mini", "t1", copy);
    expect(await readCopyBase(project.paths, "mini", "t1")).toMatchObject({ threadId: "t1", ...copy });

    await writeFile(file, "not json");
    expect(await readCopyBase(project.paths, "mini", "t1")).toBeUndefined();
  });
});
