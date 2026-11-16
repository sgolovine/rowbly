import { stat } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { useTempDir } from "../test-project/test-project.js";
import { hostAgentPaths, prepareAgentDirs, slotPaths, validateProjectId } from "./host-agent-paths.js";

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
    expect(slotPaths(home.path)).toEqual({
      dir: join(home.path, ".local/share/rowbly/slots"),
      limit: join(home.path, ".local/share/rowbly/slots/limit.json"),
      lock: join(home.path, ".local/share/rowbly/slots/slots.lock"),
    });
  });

  it("makes the runtime folder and its subfolders with mode 0700", async () => {
    const paths = hostAgentPaths("p1", home.path);
    await prepareAgentDirs(paths);
    for (const dir of [paths.dir, paths.control, paths.receipts, paths.outbox, paths.logs]) {
      expect((await stat(dir)).mode & 0o777).toBe(0o700);
    }
  });
});
