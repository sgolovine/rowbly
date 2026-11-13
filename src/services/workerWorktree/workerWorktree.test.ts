import { execFile } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { promisify } from "node:util";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ConflictError } from "../errors/errors.js";
import type { Story } from "../story/story.js";
import { useTempDir } from "../testProject/testProject.js";
import { prepareWorkerWorktree } from "./workerWorktree.js";

const exec = promisify(execFile);

describe("Story worktree", () => {
  const dir = useTempDir();
  afterEach(() => vi.unstubAllEnvs());
  async function fixture() {
    const root = join(dir.path, "repo");
    await mkdir(root);
    await exec("git", ["init", root]);
    await exec("git", [
      "-C",
      root,
      "-c",
      "user.name=Test",
      "-c",
      "user.email=test@example.com",
      "commit",
      "--allow-empty",
      "-m",
      "base",
    ]);
    const story: Story = {
      id: "TST-01",
      number: 1,
      stage: "IN_DEVELOPMENT",
      title: "Test",
      description: "",
      position: 1,
      fields: {},
      path: "",
    };
    return { root, story };
  }
  async function commit(path: string, message: string) {
    await exec("git", ["-C", path, "add", "notes"]);
    await exec("git", [
      "-C",
      path,
      "-c",
      "user.name=Test",
      "-c",
      "user.email=test@example.com",
      "commit",
      "-m",
      message,
    ]);
  }
  async function reviewFixture(root: string) {
    const remote = join(dir.path, "remote.git");
    await exec("git", ["init", "--bare", remote]);
    await exec("git", ["-C", root, "remote", "add", "origin", remote]);
    await exec("git", ["-C", root, "branch", "pr-head"]);
    await exec("git", ["-C", root, "push", "origin", "pr-head"]);
    const bin = join(dir.path, "bin");
    await mkdir(bin);
    await writeFile(join(bin, "gh"), "#!/bin/sh\nprintf 'pr-head\\n'\n", { mode: 0o700 });
    vi.stubEnv("PATH", `${bin}:${process.env.PATH}`);
  }
  it.each(["default", "saved"])("moves from refinement to development with the %s path", async (mode) => {
    const { root, story } = await fixture();
    const first = await prepareWorkerWorktree(root, { ...story, stage: "IN_REFINEMENT" });
    await writeFile(join(first.path, "notes"), "refinement commit");
    await commit(first.path, "refine");
    const head = (await exec("git", ["-C", first.path, "rev-parse", "HEAD"])).stdout;
    await writeFile(join(first.path, "notes"), "dirty refinement");
    await writeFile(join(first.path, "untracked"), "keep");
    const next = await prepareWorkerWorktree(root, {
      ...story,
      fields: mode === "saved" ? { worktree: first.path } : {},
    });
    expect(next).toEqual({ path: first.path, branch: "story/TST-01" });
    expect((await exec("git", ["-C", first.path, "rev-parse", "HEAD"])).stdout).toBe(head);
    expect((await exec("git", ["-C", first.path, "branch", "--show-current"])).stdout.trim()).toBe(next.branch);
    expect(await readFile(join(first.path, "notes"), "utf8")).toBe("dirty refinement");
    expect(await readFile(join(first.path, "untracked"), "utf8")).toBe("keep");
  });
  it("rejects an unrelated named branch", async () => {
    const { root, story } = await fixture();
    const first = await prepareWorkerWorktree(root, { ...story, stage: "IN_REFINEMENT" });
    await exec("git", ["-C", first.path, "switch", "-c", "unrelated"]);
    await expect(prepareWorkerWorktree(root, story)).rejects.toThrow("branch differs");
    expect((await exec("git", ["-C", first.path, "branch", "--show-current"])).stdout.trim()).toBe("unrelated");
  });
  it("switches a detached worktree to an existing branch and preserves dirty files", async () => {
    const { root, story } = await fixture();
    await exec("git", ["-C", root, "branch", "story/TST-01"]);
    const first = await prepareWorkerWorktree(root, { ...story, stage: "IN_REFINEMENT" });
    await writeFile(join(first.path, "dirty"), "keep");
    expect(await prepareWorkerWorktree(root, story)).toEqual({ path: first.path, branch: "story/TST-01" });
    expect(await readFile(join(first.path, "dirty"), "utf8")).toBe("keep");
  });
  it("surfaces Git's refusal and preserves detached HEAD, index and dirty files", async () => {
    const { root, story } = await fixture();
    await writeFile(join(root, "notes"), "base");
    await commit(root, "base notes");
    const first = await prepareWorkerWorktree(root, { ...story, stage: "IN_REFINEMENT" });
    await writeFile(join(root, "notes"), "branch change");
    await commit(root, "branch notes");
    await exec("git", ["-C", root, "branch", "story/TST-01"]);
    await writeFile(join(first.path, "notes"), "dirty refinement");
    await exec("git", ["-C", first.path, "add", "notes"]);
    const head = (await exec("git", ["-C", first.path, "rev-parse", "HEAD"])).stdout;
    const status = (await exec("git", ["-C", first.path, "status", "--porcelain"])).stdout;
    const index = (await exec("git", ["-C", first.path, "diff", "--cached"])).stdout;
    await expect(prepareWorkerWorktree(root, story)).rejects.toMatchObject({
      code: "CONFLICT",
      hint: expect.stringContaining("would be overwritten"),
    });
    expect((await exec("git", ["-C", first.path, "branch", "--show-current"])).stdout.trim()).toBe("");
    expect((await exec("git", ["-C", first.path, "rev-parse", "HEAD"])).stdout).toBe(head);
    expect((await exec("git", ["-C", first.path, "status", "--porcelain"])).stdout).toBe(status);
    expect((await exec("git", ["-C", first.path, "diff", "--cached"])).stdout).toBe(index);
    expect(await readFile(join(first.path, "notes"), "utf8")).toBe("dirty refinement");
  });
  it("rejects a required branch checked out in another worktree", async () => {
    const { root, story } = await fixture();
    const first = await prepareWorkerWorktree(root, { ...story, stage: "IN_REFINEMENT" });
    await exec("git", ["-C", root, "worktree", "add", "-b", "story/TST-01", join(dir.path, "other")]);
    await expect(prepareWorkerWorktree(root, story)).rejects.toBeInstanceOf(ConflictError);
    expect((await exec("git", ["-C", first.path, "branch", "--show-current"])).stdout.trim()).toBe("");
  });
  it.each([true, false])("selects the PR head from detached refinement (local branch exists: %s)", async (known) => {
    const { root, story } = await fixture();
    await reviewFixture(root);
    if (!known) await exec("git", ["-C", root, "branch", "-D", "pr-head"]);
    const first = await prepareWorkerWorktree(root, { ...story, stage: "IN_REFINEMENT" });
    await writeFile(join(first.path, "notes"), "refinement commit");
    await commit(first.path, "refine");
    const head = (await exec("git", ["-C", first.path, "rev-parse", "HEAD"])).stdout;
    await writeFile(join(first.path, "dirty"), "keep");
    const next = await prepareWorkerWorktree(root, {
      ...story,
      stage: "IN_REVIEW",
      fields: { worktree: first.path, pull_request: "https://github.com/example/repo/pull/1" },
    });
    expect(next).toEqual({ path: first.path, branch: "pr-head" });
    expect((await exec("git", ["-C", first.path, "branch", "--show-current"])).stdout.trim()).toBe("pr-head");
    if (!known) expect((await exec("git", ["-C", first.path, "rev-parse", "HEAD"])).stdout).toBe(head);
    expect(await readFile(join(first.path, "dirty"), "utf8")).toBe("keep");
  });
  it("preserves dirty work on continuation and rejects the main checkout", async () => {
    const { root, story } = await fixture();
    const first = await prepareWorkerWorktree(root, story);
    await writeFile(join(first.path, "dirty"), "keep");
    expect(await prepareWorkerWorktree(root, story)).toEqual(first);
    expect(await readFile(join(first.path, "dirty"), "utf8")).toBe("keep");
    await expect(prepareWorkerWorktree(root, { ...story, fields: { worktree: root } })).rejects.toThrow(
      "main checkout",
    );
  });
  it("uses the pull request head for review", async () => {
    const { root, story } = await fixture();
    await reviewFixture(root);
    const worktree = await prepareWorkerWorktree(root, {
      ...story,
      stage: "IN_REVIEW",
      fields: { pull_request: "https://github.com/example/repo/pull/1" },
    });
    expect(worktree.branch).toBe("pr-head");
    expect((await exec("git", ["-C", worktree.path, "branch", "--show-current"])).stdout.trim()).toBe("pr-head");
  });
});
