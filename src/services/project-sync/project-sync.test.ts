import { execFile } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { promisify } from "node:util";
import { describe, expect, it, vi } from "vitest";
import * as projectWrite from "../project-write/project-write.js";
import { useTempDir } from "../test-project/test-project.js";
import { syncCanonicalProject } from "./project-sync.js";

const run = promisify(execFile);
const git = async (cwd: string, ...args: string[]) => (await run("git", ["-C", cwd, ...args])).stdout.trim();

async function clone(remote: string, path: string): Promise<string> {
  await run("git", ["clone", "-q", remote, path]);
  await git(path, "config", "user.name", "Test");
  await git(path, "config", "user.email", "test@example.com");
  return path;
}

async function commit(cwd: string, file: string, text: string): Promise<string> {
  await mkdir(join(cwd, ".rowbly"), { recursive: true });
  await writeFile(join(cwd, file), text);
  await git(cwd, "add", file);
  await git(cwd, "commit", "-q", "-m", `change ${file}`);
  return git(cwd, "rev-parse", "HEAD");
}

/** A bare remote, the canonical checkout and a second clone that stands in for another machine. */
async function setup(base: string) {
  const remote = join(base, "remote.git");
  await run("git", ["init", "-q", "--bare", "-b", "main", remote]);
  const seed = await clone(remote, join(base, "seed"));
  await git(seed, "checkout", "-q", "-b", "main");
  await commit(seed, ".rowbly/ROWBLY.md", "# Start\n");
  await git(seed, "push", "-q", "-u", "origin", "main");
  const root = await clone(remote, join(base, "canonical root"));
  const other = await clone(remote, join(base, "other"));
  return { remote, root, other };
}

describe("syncCanonicalProject", () => {
  const dir = useTempDir();

  it("runs no Git command and takes no lock with push and pull off", async () => {
    const lock = vi.spyOn(projectWrite, "projectWrite");
    expect(await syncCanonicalProject(join(dir.path, "missing"), { push: false, pull: false })).toEqual({});
    expect(lock).not.toHaveBeenCalled();
    lock.mockRestore();
  });

  it("fast-forwards the canonical branch to its upstream", async () => {
    const { root, other } = await setup(dir.path);
    const head = await commit(other, ".rowbly/other.md", "other\n");
    await git(other, "push", "-q");

    const result = await syncCanonicalProject(root, { push: false, pull: true });

    expect(result).toEqual({ pull: { status: "ok", detail: "fast-forward" } });
    expect(await git(root, "rev-parse", "HEAD")).toBe(head);
  });

  it("merges a diverged upstream, then pushes the merge without force", async () => {
    const { remote, root, other } = await setup(dir.path);
    await commit(other, ".rowbly/other.md", "other\n");
    await git(other, "push", "-q");
    await commit(root, ".rowbly/local.md", "local\n");

    const result = await syncCanonicalProject(root, { push: true, pull: true });

    expect(result.pull).toEqual({ status: "ok", detail: "merged" });
    expect(result.push?.status).toBe("ok");
    expect(await git(root, "rev-list", "@{u}..HEAD")).toBe("");
    expect(await git(remote, "rev-parse", "main")).toBe(await git(root, "rev-parse", "HEAD"));
    expect(await readFile(join(root, ".rowbly/other.md"), "utf8")).toBe("other\n");
  });

  it("aborts a merge with a conflict and keeps the checkout as before", async () => {
    const { root, other } = await setup(dir.path);
    await commit(other, ".rowbly/ROWBLY.md", "# Other\n");
    await git(other, "push", "-q");
    const head = await commit(root, ".rowbly/ROWBLY.md", "# Local\n");

    const result = await syncCanonicalProject(root, { push: false, pull: true });

    expect(result.pull?.status).toBe("failed");
    expect(result.pull?.detail).toMatch(/conflict/i);
    expect(await git(root, "rev-parse", "HEAD")).toBe(head);
    expect(await git(root, "status", "--porcelain")).toBe("");
    await expect(git(root, "rev-parse", "-q", "--verify", "MERGE_HEAD")).rejects.toBeDefined();
    expect(await readFile(join(root, ".rowbly/ROWBLY.md"), "utf8")).toBe("# Local\n");
  });

  it("pushes local commits and skips the push without them", async () => {
    const { remote, root } = await setup(dir.path);
    expect(await syncCanonicalProject(root, { push: true, pull: false })).toEqual({
      push: { status: "skipped", detail: "no local commits" },
    });
    const head = await commit(root, ".rowbly/local.md", "local\n");

    const result = await syncCanonicalProject(root, { push: true, pull: false });

    expect(result).toEqual({ push: { status: "ok", detail: "1 commits" } });
    expect(await git(root, "rev-list", "@{u}..HEAD")).toBe("");
    expect(await git(remote, "rev-parse", "main")).toBe(head);
  });

  it("gives a failure for a rejected push, and pushes after a failed pull", async () => {
    const { root, other } = await setup(dir.path);
    await commit(other, ".rowbly/other.md", "other\n");
    await git(other, "push", "-q");
    await commit(root, ".rowbly/local.md", "local\n");

    const result = await syncCanonicalProject(root, { push: true, pull: false });

    expect(result.push?.status).toBe("failed");
    expect(result.push?.detail).toMatch(/rejected|fetch first/i);
  });

  it("gives failures for a branch without upstream, a detached HEAD and an unreachable remote", async () => {
    const { root } = await setup(dir.path);
    await git(root, "checkout", "-q", "-b", "local-only");
    expect(await syncCanonicalProject(root, { push: true, pull: true })).toEqual({
      pull: { status: "failed", detail: "The current branch has no upstream branch." },
      push: { status: "failed", detail: "The current branch has no upstream branch." },
    });

    await git(root, "checkout", "-q", "--detach", "main");
    expect((await syncCanonicalProject(root, { push: false, pull: true })).pull).toEqual({
      status: "failed",
      detail: "HEAD is detached. Sync needs a branch.",
    });

    await git(root, "checkout", "-q", "main");
    await git(root, "remote", "set-url", "origin", join(dir.path, "gone.git"));
    const result = await syncCanonicalProject(root, { push: false, pull: true });
    expect(result.pull?.status).toBe("failed");
    expect(result.pull?.detail).toMatch(/gone\.git|repository/i);
  });

  it("does not start a pull while a merge of a person is in progress", async () => {
    const { root, other } = await setup(dir.path);
    await commit(other, ".rowbly/ROWBLY.md", "# Other\n");
    await git(other, "push", "-q");
    await commit(root, ".rowbly/ROWBLY.md", "# Local\n");
    await git(root, "fetch", "-q");
    await expect(git(root, "merge", "@{u}")).rejects.toBeDefined();

    const result = await syncCanonicalProject(root, { push: false, pull: true });

    expect(result.pull?.detail).toMatch(/merge is in progress/);
    expect(await git(root, "rev-parse", "-q", "--verify", "MERGE_HEAD")).not.toBe("");
  });

  it("holds the Project write lock while Git runs", async () => {
    const { root } = await setup(dir.path);
    const lock = vi.spyOn(projectWrite, "projectWrite");

    await syncCanonicalProject(root, { push: true, pull: true });

    expect(lock).toHaveBeenCalledWith(root, expect.any(Function));
    lock.mockRestore();
  });
});
