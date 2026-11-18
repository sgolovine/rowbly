import { lstat, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { useTempDir } from "../test-project/test-project.js";
import { RC_FILE } from "../user-rc/user-rc.js";
import { readLayoutPrefs, writeLayoutPrefs } from "./layout-prefs.js";

describe("layout prefs", () => {
  const dir = useTempDir();
  const ctx = () => ({ home: dir.path });
  const rcFile = () => join(dir.path, RC_FILE);
  const stored = async () => JSON.parse(await readFile(rcFile(), "utf8"));

  it("reads no sizes, and creates no file, when the file is missing", async () => {
    expect(await readLayoutPrefs(ctx())).toEqual({});
    await expect(lstat(rcFile())).rejects.toThrow();
  });

  it("reads no sizes from a file without a layout key", async () => {
    await writeFile(rcFile(), JSON.stringify({ projects: [] }));

    expect(await readLayoutPrefs(ctx())).toEqual({});
  });

  it.each([
    ["a string", "wide"],
    ["an array", [30]],
    ["null", null],
    ["a number", 3],
  ])("reads no sizes, and does not throw, when the layout is %s", async (_name, layout) => {
    await writeFile(rcFile(), JSON.stringify({ layout }));

    expect(await readLayoutPrefs(ctx())).toEqual({});
  });

  it("gives no value for a size that is not a positive integer", async () => {
    await writeFile(rcFile(), JSON.stringify({ layout: { sidebarWidth: 0, tagsHeight: 2.5, storyWidth: "70" } }));
    expect(await readLayoutPrefs(ctx())).toEqual({});

    await writeFile(rcFile(), JSON.stringify({ layout: { sidebarWidth: -4, tagsHeight: 8, storyWidth: null } }));
    expect(await readLayoutPrefs(ctx())).toEqual({ tagsHeight: 8 });
  });

  it("writes the sizes and reads them back", async () => {
    await writeLayoutPrefs({ sidebarWidth: 30, tagsHeight: 8, storyWidth: 70 }, ctx());

    expect(await readLayoutPrefs(ctx())).toEqual({ sidebarWidth: 30, tagsHeight: 8, storyWidth: 70 });
    expect((await stored()).layout).toEqual({ sidebarWidth: 30, tagsHeight: 8, storyWidth: 70 });
  });

  it("keeps all other keys of the file", async () => {
    const other = { projects: [{ path: "/a", name: "A" }], hosts: [{ name: "h" }], deviceId: "d", version: 1 };

    await writeFile(rcFile(), JSON.stringify(other));
    await writeLayoutPrefs({ storyWidth: 70 }, ctx());

    expect(await stored()).toEqual({ ...other, layout: { storyWidth: 70 } });
  });

  it("changes only the given sizes and keeps the other saved sizes", async () => {
    await writeLayoutPrefs({ sidebarWidth: 30, tagsHeight: 8 }, ctx());
    await writeLayoutPrefs({ tagsHeight: 12, storyWidth: 60 }, ctx());

    expect((await stored()).layout).toEqual({ sidebarWidth: 30, tagsHeight: 12, storyWidth: 60 });
  });

  it("replaces a bad layout value and does not write a bad size", async () => {
    await writeFile(rcFile(), JSON.stringify({ layout: "wide" }));
    await writeLayoutPrefs({ sidebarWidth: 30, storyWidth: 0 }, ctx());

    expect((await stored()).layout).toEqual({ sidebarWidth: 30 });
  });

  it("writes nothing when no size changes", async () => {
    // A compact file shows if Rowbly writes it again: a write formats it with indentation.
    const compact = JSON.stringify({ deviceId: "d", layout: { sidebarWidth: 30, tagsHeight: 8 } });

    await writeFile(rcFile(), compact);
    await writeLayoutPrefs({ sidebarWidth: 30 }, ctx());

    expect(await readFile(rcFile(), "utf8")).toBe(compact);
  });

  it("writes nothing when no file exists and no size is given", async () => {
    await writeLayoutPrefs({}, ctx());

    await expect(lstat(rcFile())).rejects.toThrow();
  });

  it.each([
    ["invalid JSON", "{"],
    ["an array", "[]"],
    ["null", "null"],
  ])("does not write a file that is %s", async (_name, text) => {
    await writeFile(rcFile(), text);

    await expect(writeLayoutPrefs({ sidebarWidth: 30 }, ctx())).rejects.toMatchObject({ code: "VALIDATION" });
    expect(await readFile(rcFile(), "utf8")).toBe(text);
  });
});
