import { execFile } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { promisify } from "node:util";
import { afterEach, describe, expect, it, vi } from "vitest";
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
    const remote = join(dir.path, "remote.git");
    await exec("git", ["init", "--bare", remote]);
    await exec("git", ["-C", root, "remote", "add", "origin", remote]);
    await exec("git", ["-C", root, "branch", "pr-head"]);
    await exec("git", ["-C", root, "push", "origin", "pr-head"]);
    const bin = join(dir.path, "bin");
    await mkdir(bin);
    await writeFile(join(bin, "gh"), "#!/bin/sh\nprintf 'pr-head\\n'\n", { mode: 0o700 });
    vi.stubEnv("PATH", `${bin}:${process.env.PATH}`);
    const worktree = await prepareWorkerWorktree(root, {
      ...story,
      stage: "IN_REVIEW",
      fields: { pull_request: "https://github.com/example/repo/pull/1" },
    });
    expect(worktree.branch).toBe("pr-head");
    expect((await exec("git", ["-C", worktree.path, "branch", "--show-current"])).stdout.trim()).toBe("pr-head");
  });
});
