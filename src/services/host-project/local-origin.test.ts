import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { describe, expect, it } from "vitest";
import { useTempDir } from "../test-project/test-project.js";
import { localOrigin } from "./local-origin.js";

const git = promisify(execFile);

describe("local-origin", () => {
  const dir = useTempDir();

  it("gives the origin URL of the local repository", async () => {
    await git("git", ["init", "-q", dir.path]);
    await git("git", ["-C", dir.path, "remote", "add", "origin", "git@github.com:o/r.git"]);

    expect(await localOrigin(dir.path)).toBe("git@github.com:o/r.git");
  });

  it("gives VALIDATION with a hint without origin", async () => {
    await git("git", ["init", "-q", dir.path]);

    await expect(localOrigin(dir.path)).rejects.toMatchObject({
      code: "VALIDATION",
      hint: expect.stringContaining("git remote add origin"),
    });
  });
});
