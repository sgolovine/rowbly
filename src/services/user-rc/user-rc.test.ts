import { lstat, readFile, stat, symlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { useTempDir } from "../test-project/test-project.js";
import { RC_FILE, rcPath, readRc, writeRc } from "./user-rc.js";

describe("user rc", () => {
  const dir = useTempDir();
  const file = () => join(dir.path, RC_FILE);

  it("gives the file in the home directory of the context", () => {
    expect(rcPath({ home: "/home/me" })).toBe(join("/home/me", ".rowblyrc.json"));
  });

  it("reads a missing file as an empty object", async () => {
    expect(await readRc(file())).toEqual({});
  });

  it.each([
    ["invalid JSON", "{"],
    ["an array", "[]"],
    ["null", "null"],
    ["a number", "1"],
  ])("refuses %s with VALIDATION and a hint", async (_name, text) => {
    await writeFile(file(), text);

    await expect(readRc(file())).rejects.toMatchObject({
      code: "VALIDATION",
      message: `${file()} is invalid`,
      hint: "Fix the file by hand.",
    });
  });

  it("writes the whole object as JSON and reads it back", async () => {
    await writeRc(file(), { projects: [], deviceId: "d" });

    expect(await readFile(file(), "utf8")).toBe(`${JSON.stringify({ projects: [], deviceId: "d" }, null, 2)}\n`);
    expect(await readRc(file())).toEqual({ projects: [], deviceId: "d" });
  });

  it("writes through a symbolic link and keeps the link", async () => {
    const real = join(dir.path, "dotfile.json");

    await writeFile(real, "{}");
    await symlink(real, file());
    await writeRc(file(), { a: 1 });

    expect((await lstat(file())).isSymbolicLink()).toBe(true);
    expect(JSON.parse(await readFile(real, "utf8"))).toEqual({ a: 1 });
  });

  it.skipIf(process.platform === "win32")("creates a new file with the given mode", async () => {
    await writeRc(file(), { deviceId: "d" }, { mode: 0o600 });

    expect((await stat(file())).mode & 0o777).toBe(0o600);
  });
});
