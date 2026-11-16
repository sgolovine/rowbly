import { stat } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { useTempDir } from "../test-project/test-project.js";
import {
  hostAgentPaths,
  hostAgentPathsAt,
  hostRunPaths,
  hostRunPathsAnswer,
  prepareAgentDirs,
  slotPaths,
  threadPaths,
  validateProjectId,
} from "./host-agent-paths.js";

describe("host agent paths", () => {
  const home = useTempDir();

  it("accepts a dash-case project id of 1 to 64 characters", () => {
    for (const id of ["a", "p1", "my-project-2", "x".repeat(64)]) expect(validateProjectId(id)).toBe(id);
  });

  it("refuses a bad project id before a file is written", () => {
    for (const id of ["", "A", "-a", "a-", "a--b", "a_b", "a/b", "../x", "x".repeat(65), 5, undefined]) {
      expect(() => validateProjectId(id)).toThrow(expect.objectContaining({ code: "VALIDATION" }));
    }
    expect(() => hostAgentPaths("../escape", home.path)).toThrow(expect.objectContaining({ code: "VALIDATION" }));
  });

  it("puts the runtime folder and the slots below .local/share/rowbly of the home folder", () => {
    const paths = hostAgentPaths("p1", home.path);
    expect(paths.dir).toBe(join(home.path, ".local/share/rowbly/projects/p1/agent"));
    expect(paths.lock).toBe(join(paths.dir, "agent.lock"));
    expect(paths.guard).toBe(join(paths.dir, "agent.guard"));
    expect(paths.state).toBe(join(paths.dir, "agent.json"));
    expect(paths.outbox).toBe(join(paths.dir, "outbox"));
    expect(paths.threads).toBe(join(paths.dir, "threads"));
    expect(paths.runtime).toBe(join(paths.dir, "runtime"));
    expect(paths.attachments).toBe(join(paths.dir, "attachments"));
    expect(paths.bin).toBe(join(paths.dir, "bin/rowbly"));
    expect(paths.fetch).toBe(join(paths.dir, "fetch"));
    expect(paths.channel).toBe(join(paths.dir, "channel.json"));
    expect(threadPaths(paths, "t1")).toEqual({
      dir: join(paths.dir, "threads/t1"),
      copy: join(paths.dir, "threads/t1/copy"),
      launch: join(paths.dir, "threads/t1/launch.json"),
      run: join(paths.dir, "threads/t1/run.json"),
      lock: join(paths.dir, "threads/t1/write.lock"),
    });
    expect(() => threadPaths(paths, "../x")).toThrow(expect.objectContaining({ code: "VALIDATION" }));
    expect(slotPaths(home.path)).toEqual({
      dir: join(home.path, ".local/share/rowbly/slots"),
      limit: join(home.path, ".local/share/rowbly/slots/limit.json"),
      lock: join(home.path, ".local/share/rowbly/slots/slots.lock"),
    });
  });

  it("makes the runtime folder and its subfolders with mode 0700", async () => {
    const paths = hostAgentPaths("p1", home.path);
    await prepareAgentDirs(paths);
    for (const dir of [
      paths.dir,
      paths.control,
      paths.receipts,
      paths.outbox,
      paths.logs,
      paths.threads,
      paths.runtime,
      paths.attachments,
      paths.fetch,
    ]) {
      expect((await stat(dir)).mode & 0o777).toBe(0o700);
    }
  });

  it("gives the same paths from the absolute agent folder, and refuses a relative or bad folder", () => {
    const paths = hostAgentPaths("p1", home.path);
    expect(hostAgentPathsAt(paths.dir)).toEqual(paths);
    expect(hostAgentPathsAt(`${paths.dir}/`)).toEqual(paths);
    for (const dir of ["relative/p1/agent", "/x/Bad_Id/agent"]) {
      expect(() => hostAgentPathsAt(dir)).toThrow(expect.objectContaining({ code: "VALIDATION" }));
    }
  });

  it("gives the run paths of a Thread with a clone relative to the home folder", () => {
    const run = hostRunPaths({
      home: "/home/u",
      projectId: "p1",
      clone: "work/repo",
      threadId: "t1",
      storyId: "ROW-7",
    });
    const agent = "/home/u/.local/share/rowbly/projects/p1/agent";
    expect(run).toEqual({
      clone: "/home/u/work/repo",
      copy: `${agent}/threads/t1/copy`,
      worktree: "/home/u/work/repo-worktrees/ROW-7",
      lock: `${agent}/threads/t1/write.lock`,
      shim: `${agent}/bin/rowbly`,
      outbox: `${agent}/outbox`,
    });
    expect(() => hostRunPaths({ home: "/h", projectId: "p1", clone: "r", threadId: "t1", storyId: "../x" })).toThrow(
      expect.objectContaining({ code: "VALIDATION" }),
    );
  });

  it("answers `host run-paths` with the paths below the home folder, and refuses a bad input", () => {
    const answer = hostRunPathsAnswer("p1", { threadId: "t1", storyId: "ROW-7", clone: "work/repo" }, "/home/u");
    expect(answer).toEqual(
      hostRunPaths({ home: "/home/u", projectId: "p1", clone: "work/repo", threadId: "t1", storyId: "ROW-7" }),
    );
    for (const bad of [
      null,
      { threadId: "t1", storyId: "ROW-7" },
      { threadId: "../t", storyId: "ROW-7", clone: "r" },
    ]) {
      expect(() => hostRunPathsAnswer("p1", bad, "/home/u")).toThrow(expect.objectContaining({ code: "VALIDATION" }));
    }
  });
});
