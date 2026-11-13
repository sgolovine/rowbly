// Tests commit-project.mjs in temporary Git repositories.
//
// Run with `pnpm test:factory`. This suite uses node:test and is separate from the Vitest suite in src/.

import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { chmod, mkdir, mkdtemp, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, it } from "node:test";
import { setTimeout as sleep } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import { commitProject, lockPath } from "./commit-project.mjs";

const script = fileURLToPath(new URL("./commit-project.mjs", import.meta.url));
const identity = { GIT_AUTHOR_NAME: "Test", GIT_AUTHOR_EMAIL: "test@example.com", GIT_COMMITTER_NAME: "Test", GIT_COMMITTER_EMAIL: "test@example.com" };
let root;

const git = (...args) => {
  const result = spawnSync("git", ["-C", root, ...args], { encoding: "utf8", env: { ...process.env, ...identity } });
  assert.equal(result.status, 0, result.stderr);
  return result.stdout;
};
const write = async (path, text) => {
  await mkdir(join(root, path, ".."), { recursive: true });
  await writeFile(join(root, path), text);
};
const commits = () => git("rev-list", "--count", "HEAD").trim();

beforeEach(async () => {
  Object.assign(process.env, identity);
  root = await realpath(await mkdtemp(join(tmpdir(), "rowbly-commit-")));
  git("init", "-q");
  await write(".gitignore", ".rowbly/state.json\n.rowbly/state.json.tmp-*\n");
  await write(".rowbly/rowbly.config.json", "{}");
  await write(".rowbly/stories/ROW-01.md", "one");
  await write(".rowbly/stories/ROW-02.md", "two");
  await write("src/app.js", "app");
  git("add", "-A");
  git("commit", "-qm", "init");
});
afterEach(async () => { await rm(root, { recursive: true, force: true }); });

it("reports a clean Project and makes no commit", async () => {
  assert.deepEqual(await commitProject(root), { status: "clean" });
  assert.equal(commits(), "1");
});

it("commits changed, new and deleted Project files, and nothing else", async () => {
  await write(".rowbly/stories/ROW-01.md", "changed");
  await write(".rowbly/stories/ROW 03 new.md", "new");
  await rm(join(root, ".rowbly/stories/ROW-02.md"));
  await write(".rowbly/state.json", "{}");
  await write(".rowbly/state.json.tmp-1", "{}");
  await write(".rowbly/state.json.invalid-2026", "{}");
  await write("src/app.js", "changed app");
  await write("src/staged.js", "staged");
  git("add", "src/staged.js");

  const result = await commitProject(root, { message: "chore(rowbly): record ROW-01 move to in review" });
  assert.equal(result.status, "committed");
  assert.deepEqual(result.paths.sort(), [".rowbly/stories/ROW 03 new.md", ".rowbly/stories/ROW-01.md", ".rowbly/stories/ROW-02.md"]);
  assert.equal(git("log", "-1", "--format=%s").trim(), "chore(rowbly): record ROW-01 move to in review");
  assert.equal(git("rev-parse", "--short", "HEAD").trim(), result.commit);
  assert.deepEqual(git("show", "--name-status", "--format=", "HEAD").trim().split("\n").sort(), [
    "A\t.rowbly/stories/ROW 03 new.md", "D\t.rowbly/stories/ROW-02.md", "M\t.rowbly/stories/ROW-01.md",
  ]);
  // The source change and the staged source file stay as they were.
  assert.deepEqual(git("status", "--porcelain").trimEnd().split("\n").sort(), ["?? .rowbly/state.json.invalid-2026", "A  src/staged.js", " M src/app.js"].sort());
});

it("uses a default message that lists the paths", async () => {
  await write(".rowbly/stories/ROW-01.md", "changed");
  await commitProject(root);
  assert.equal(git("log", "-1", "--format=%B").trim(), "chore(rowbly): record project changes after scan\n\n.rowbly/stories/ROW-01.md");
});

it("keeps a file that has a staged version and a later edit, and commits the other files", async () => {
  await write(".rowbly/stories/ROW-01.md", "staged version");
  git("add", ".rowbly/stories/ROW-01.md");
  await write(".rowbly/stories/ROW-01.md", "later edit");
  assert.deepEqual(await commitProject(root), { status: "held", held: [".rowbly/stories/ROW-01.md"] });
  await write(".rowbly/stories/ROW-02.md", "changed");
  const result = await commitProject(root);
  assert.equal(result.status, "committed");
  assert.deepEqual(result.paths, [".rowbly/stories/ROW-02.md"]);
  assert.deepEqual(result.held, [".rowbly/stories/ROW-01.md"]);
  assert.equal(git("show", ":.rowbly/stories/ROW-01.md"), "staged version");
  assert.equal(await readFile(join(root, ".rowbly/stories/ROW-01.md"), "utf8"), "later edit");
});

it("makes no commit when a Project file has a merge conflict", async () => {
  git("checkout", "-qb", "other");
  await write(".rowbly/stories/ROW-01.md", "theirs");
  git("commit", "-qam", "theirs");
  git("checkout", "-q", "-");
  await write(".rowbly/stories/ROW-01.md", "ours");
  git("commit", "-qam", "ours");
  spawnSync("git", ["-C", root, "merge", "other"], { encoding: "utf8" });
  const result = await commitProject(root);
  assert.equal(result.status, "conflict");
  assert.deepEqual(result.paths, [".rowbly/stories/ROW-01.md"]);
  assert.equal(commits(), "2");
});

it("reports a failed hook and keeps the files", async () => {
  await write(".git/hooks/pre-commit", "#!/bin/sh\necho 'hook says no' >&2\nexit 1\n");
  await chmod(join(root, ".git/hooks/pre-commit"), 0o755);
  await write(".rowbly/stories/ROW-01.md", "changed");
  const result = await commitProject(root);
  assert.equal(result.status, "failed");
  assert.match(result.detail, /hook says no/);
  assert.equal(commits(), "1");
  assert.equal(await readFile(join(root, ".rowbly/stories/ROW-01.md"), "utf8"), "changed");
});

it("commits a Project in a subdirectory of the repository", async () => {
  await write("apps/web/.rowbly/stories/WEB-01.md", "web");
  await write(".rowbly/stories/ROW-01.md", "changed in the other Project");
  const result = await commitProject(join(root, "apps/web"));
  assert.deepEqual(result.paths, ["apps/web/.rowbly/stories/WEB-01.md"]);
  assert.equal(git("status", "--porcelain").trim(), "M .rowbly/stories/ROW-01.md");
});

it("continues without Git", async () => {
  await rm(join(root, ".git"), { recursive: true });
  const result = await commitProject(root, { lock: join(root, "write.lock") });
  assert.equal(result.status, "no-git");
});

it("puts the lock in the common Git directory, or next to a Project without Git", async () => {
  assert.equal(await lockPath(root), join(root, ".git", "rowbly-project-write.lock"));
  git("worktree", "add", "-q", join(root, "linked"), "-b", "linked");
  assert.equal(await lockPath(join(root, "linked")), join(root, ".git", "rowbly-project-write.lock"));
  const plain = await realpath(await mkdtemp(join(tmpdir(), "rowbly-commit-plain-")));
  try {
    assert.equal(await lockPath(plain), join(plain, ".rowbly-factory-write.lock"));
  } finally {
    await rm(plain, { recursive: true, force: true });
  }
});

it("reports a busy lock and makes no commit", async () => {
  await write(".rowbly/stories/ROW-01.md", "changed");
  const lock = await lockPath(root);
  const holder = spawn("flock", [lock, "sleep", "2"]);
  try {
    // Wait until the holder has the lock.
    while (spawnSync("flock", ["-n", lock, "true"]).status === 0) await sleep(20);
    const result = await commitProject(root, { lockWaitSeconds: 0.2 });
    assert.equal(result.status, "failed");
    assert.match(result.detail, /write lock .* is busy/);
    assert.equal(commits(), "1");
  } finally {
    holder.kill();
  }
});

it("prints the result as JSON, and the usage for bad arguments", async () => {
  await write(".rowbly/stories/ROW-01.md", "changed");
  const result = spawnSync(process.execPath, [script, "--root", root], { encoding: "utf8" });
  assert.equal(JSON.parse(result.stdout).status, "committed");
  const bad = spawnSync(process.execPath, [script], { encoding: "utf8" });
  assert.equal(bad.status, 2);
  assert.match(bad.stderr, /Usage: commit-project\.mjs/);
});

it("excludes new and already tracked runtime files from canonical commits", async () => {
  await write(".rowbly/runtime/tracked.json", "old");
  git("add", "--", ".rowbly/runtime/tracked.json");
  git("commit", "-qm", "seed tracked runtime");
  await write(".rowbly/runtime/tracked.json", "new");
  await write(".rowbly/runtime/untracked.json", "private");
  await write(".rowbly/stories/ROW-01.md", "changed");
  const result = await commitProject(root);
  assert.equal(result.status, "committed");
  assert.deepEqual(result.paths, [".rowbly/stories/ROW-01.md"]);
  assert.equal(git("show", "HEAD:.rowbly/runtime/tracked.json"), "old");
  assert.match(git("status", "--porcelain"), /runtime/);
});
