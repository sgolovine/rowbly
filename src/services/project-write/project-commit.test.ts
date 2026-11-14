import { spawn, spawnSync } from "node:child_process";
import { chmod, mkdir, mkdtemp, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { useTempDir } from "../test-project/test-project.js";
import { commitProjectFiles, lockPath } from "./project-commit.js";
import { projectWrite } from "./project-write.js";

const identity = {
  GIT_AUTHOR_NAME: "Test",
  GIT_AUTHOR_EMAIL: "test@example.com",
  GIT_COMMITTER_NAME: "Test",
  GIT_COMMITTER_EMAIL: "test@example.com",
};

describe("commitProjectFiles", () => {
  const dir = useTempDir();
  const saved = { ...process.env };
  const root = () => dir.path;

  const git = (...args: string[]) => {
    const result = spawnSync("git", ["-C", root(), ...args], {
      encoding: "utf8",
      env: { ...process.env, ...identity },
    });
    expect(result.status, result.stderr).toBe(0);
    return result.stdout;
  };
  const write = async (path: string, text: string) => {
    await mkdir(join(root(), path, ".."), { recursive: true });
    await writeFile(join(root(), path), text);
  };
  const commits = () => git("rev-list", "--count", "HEAD").trim();
  const lastIdentity = () => git("log", "-1", "--format=%an <%ae>|%cn <%ce>").trim();
  const withoutIdentityEnv = async <T>(action: () => Promise<T>): Promise<T> => {
    for (const key of Object.keys(identity)) delete process.env[key];
    try {
      return await action();
    } finally {
      Object.assign(process.env, identity);
    }
  };

  beforeEach(async () => {
    Object.assign(process.env, identity);
    git("init", "-q");
    await write(".gitignore", ".rowbly/state.json\n.rowbly/state.json.tmp-*\n");
    await write(".rowbly/rowbly.config.json", "{}");
    await write(".rowbly/stories/ROW-01.md", "one");
    await write(".rowbly/stories/ROW-02.md", "two");
    await write("src/app.js", "app");
    git("add", "-A");
    git("commit", "-qm", "init");
  });
  afterEach(() => {
    for (const key of Object.keys(process.env)) if (!(key in saved)) delete process.env[key];
    Object.assign(process.env, saved);
  });

  it("reports a clean Project and makes no commit", async () => {
    expect(await commitProjectFiles(root())).toEqual({ status: "clean" });
    expect(commits()).toBe("1");
  });

  it("commits changed, new and deleted Project files, and nothing else", async () => {
    await write(".rowbly/stories/ROW-01.md", "changed");
    await write(".rowbly/stories/ROW 03 new.md", "new");
    await rm(join(root(), ".rowbly/stories/ROW-02.md"));
    await write(".rowbly/state.json", "{}");
    await write(".rowbly/state.json.tmp-1", "{}");
    await write(".rowbly/state.json.invalid-2026", "{}");
    await write("src/app.js", "changed app");
    await write("src/staged.js", "staged");
    git("add", "src/staged.js");

    const result = await commitProjectFiles(root(), { message: "chore(rowbly): record ROW-01 move to in review" });
    expect(result.status).toBe("committed");
    expect(result.paths?.toSorted()).toEqual([
      ".rowbly/stories/ROW 03 new.md",
      ".rowbly/stories/ROW-01.md",
      ".rowbly/stories/ROW-02.md",
    ]);
    expect(git("log", "-1", "--format=%s").trim()).toBe("chore(rowbly): record ROW-01 move to in review");
    expect(git("rev-parse", "--short", "HEAD").trim()).toBe(result.commit);
    expect(git("show", "--name-status", "--format=", "HEAD").trim().split("\n").toSorted()).toEqual([
      "A\t.rowbly/stories/ROW 03 new.md",
      "D\t.rowbly/stories/ROW-02.md",
      "M\t.rowbly/stories/ROW-01.md",
    ]);
    // The source change and the staged source file stay as they were.
    expect(git("status", "--porcelain").trimEnd().split("\n").toSorted()).toEqual(
      ["?? .rowbly/state.json.invalid-2026", "A  src/staged.js", " M src/app.js"].toSorted(),
    );
  });

  it("uses a default message that lists the paths", async () => {
    await write(".rowbly/stories/ROW-01.md", "changed");
    await commitProjectFiles(root());
    expect(git("log", "-1", "--format=%B").trim()).toBe(
      "chore(rowbly): record project changes after scan\n\n.rowbly/stories/ROW-01.md",
    );
  });

  it("uses the Git config identity without an author", async () => {
    git("config", "user.name", "Config User");
    git("config", "user.email", "config@example.com");
    await write(".rowbly/stories/ROW-01.md", "changed");
    const result = await withoutIdentityEnv(() => commitProjectFiles(root()));
    expect(result.status).toBe("committed");
    expect(lastIdentity()).toBe("Config User <config@example.com>|Config User <config@example.com>");
  });

  it("sets the author and the committer from the author option, also without a Git identity", async () => {
    await write(".rowbly/stories/ROW-01.md", "changed");
    const result = await withoutIdentityEnv(() =>
      commitProjectFiles(root(), { message: "chore: custom", author: "Rowbly Bot <bot@example.com>" }),
    );
    expect(result.status, result.detail).toBe("committed");
    expect(lastIdentity()).toBe("Rowbly Bot <bot@example.com>|Rowbly Bot <bot@example.com>");
    expect(git("log", "-1", "--format=%s").trim()).toBe("chore: custom");

    await write(".rowbly/stories/ROW-02.md", "changed");
    expect((await commitProjectFiles(root(), { author: "CLI Bot <cli@example.com>" })).status).toBe("committed");
    expect(lastIdentity()).toBe("CLI Bot <cli@example.com>|CLI Bot <cli@example.com>");
  });

  it("reports an author that is not in the Name <email> form and makes no commit", async () => {
    await write(".rowbly/stories/ROW-01.md", "changed");
    const result = await commitProjectFiles(root(), { author: "no email" });
    expect(result.status).toBe("failed");
    expect(result.detail).toMatch(/Name <email>/);
    expect(commits()).toBe("1");
  });

  it("keeps a file that has a staged version and a later edit, and commits the other files", async () => {
    await write(".rowbly/stories/ROW-01.md", "staged version");
    git("add", ".rowbly/stories/ROW-01.md");
    await write(".rowbly/stories/ROW-01.md", "later edit");
    expect(await commitProjectFiles(root())).toEqual({ status: "held", held: [".rowbly/stories/ROW-01.md"] });
    await write(".rowbly/stories/ROW-02.md", "changed");
    const result = await commitProjectFiles(root());
    expect(result.status).toBe("committed");
    expect(result.paths).toEqual([".rowbly/stories/ROW-02.md"]);
    expect(result.held).toEqual([".rowbly/stories/ROW-01.md"]);
    expect(git("show", ":.rowbly/stories/ROW-01.md")).toBe("staged version");
    expect(await readFile(join(root(), ".rowbly/stories/ROW-01.md"), "utf8")).toBe("later edit");
  });

  it("makes no commit when a Project file has a merge conflict", async () => {
    git("checkout", "-qb", "other");
    await write(".rowbly/stories/ROW-01.md", "theirs");
    git("commit", "-qam", "theirs");
    git("checkout", "-q", "-");
    await write(".rowbly/stories/ROW-01.md", "ours");
    git("commit", "-qam", "ours");
    spawnSync("git", ["-C", root(), "merge", "other"], { encoding: "utf8" });
    const result = await commitProjectFiles(root());
    expect(result.status).toBe("conflict");
    expect(result.paths).toEqual([".rowbly/stories/ROW-01.md"]);
    expect(commits()).toBe("2");
  });

  it("reports a failed hook and keeps the files", async () => {
    await write(".git/hooks/pre-commit", "#!/bin/sh\necho 'hook says no' >&2\nexit 1\n");
    await chmod(join(root(), ".git/hooks/pre-commit"), 0o755);
    await write(".rowbly/stories/ROW-01.md", "changed");
    const result = await commitProjectFiles(root());
    expect(result.status).toBe("failed");
    expect(result.detail).toMatch(/hook says no/);
    expect(commits()).toBe("1");
    expect(await readFile(join(root(), ".rowbly/stories/ROW-01.md"), "utf8")).toBe("changed");
  });

  it("commits a Project in a subdirectory of the repository", async () => {
    await write("apps/web/.rowbly/stories/WEB-01.md", "web");
    await write(".rowbly/stories/ROW-01.md", "changed in the other Project");
    const result = await commitProjectFiles(join(root(), "apps/web"));
    expect(result.paths).toEqual(["apps/web/.rowbly/stories/WEB-01.md"]);
    expect(git("status", "--porcelain").trim()).toBe("M .rowbly/stories/ROW-01.md");
  });

  it("continues without Git", async () => {
    await rm(join(root(), ".git"), { recursive: true });
    expect((await commitProjectFiles(root())).status).toBe("no-git");
  });

  it("puts the lock in the common Git directory, or next to a Project without Git", async () => {
    const real = await realpath(root());
    expect(await lockPath(root())).toBe(join(real, ".git", "rowbly-project-write.lock"));
    git("worktree", "add", "-q", join(root(), "linked"), "-b", "linked");
    expect(await lockPath(join(root(), "linked"))).toBe(join(real, ".git", "rowbly-project-write.lock"));
    const plain = await realpath(await mkdtemp(join(tmpdir(), "rowbly-commit-plain-")));
    try {
      expect(await lockPath(plain)).toBe(join(plain, ".rowbly-factory-write.lock"));
    } finally {
      await rm(plain, { recursive: true, force: true });
    }
  });

  it("reports a busy lock and makes no commit", async () => {
    await write(".rowbly/stories/ROW-01.md", "changed");
    const lock = await lockPath(root());
    const holder = spawn("flock", [lock, "sleep", "2"]);
    try {
      // Wait until the holder has the lock.
      while (spawnSync("flock", ["-n", lock, "true"]).status === 0) await sleep(20);
      await expect(projectWrite(root(), () => commitProjectFiles(root()), 0.2)).rejects.toMatchObject({
        code: "CONFLICT",
      });
      expect(commits()).toBe("1");
    } finally {
      holder.kill();
    }
  });

  it("excludes new and already tracked runtime files from canonical commits", async () => {
    await write(".rowbly/runtime/tracked.json", "old");
    git("add", "--", ".rowbly/runtime/tracked.json");
    git("commit", "-qm", "seed tracked runtime");
    await write(".rowbly/runtime/tracked.json", "new");
    await write(".rowbly/runtime/untracked.json", "private");
    await write(".rowbly/stories/ROW-01.md", "changed");
    const result = await commitProjectFiles(root());
    expect(result.status).toBe("committed");
    expect(result.paths).toEqual([".rowbly/stories/ROW-01.md"]);
    expect(git("show", "HEAD:.rowbly/runtime/tracked.json")).toBe("old");
    expect(git("status", "--porcelain")).toMatch(/runtime/);
  });
});
