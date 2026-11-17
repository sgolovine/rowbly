import { describe, expect, it } from "vitest";
import { useTempDir } from "../test-project/test-project.js";
import { hostAgentPaths } from "./host-agent-paths.js";
import { type HostRunState, writeHostRun } from "./host-run-state.js";
import { hostRuns } from "./host-runs.js";

function runState(threadId: string): HostRunState {
  const now = new Date().toISOString();

  return {
    version: 1,
    threadId,
    requestId: `req-${threadId}`,
    kind: "launch",
    phase: "running",
    startedAt: now,
    updatedAt: now,
  };
}

describe("hostRuns", () => {
  const dir = useTempDir();

  it("gives the run state of each requested Thread that has one, and skips the others", async () => {
    const paths = hostAgentPaths("project", dir.path);
    await writeHostRun(paths, runState("one"), false);
    await writeHostRun(paths, runState("two"), false);

    const answer = await hostRuns(paths, { threadIds: ["one", "missing", "one"] });

    expect(answer.runs.map((run) => run.threadId)).toEqual(["one"]);
    expect(answer.runs[0]).toMatchObject({ requestId: "req-one", phase: "running" });
    expect((await hostRuns(paths, { threadIds: [] })).runs).toEqual([]);
  });

  it("refuses an input without a list, and a Thread id that is not valid", async () => {
    const paths = hostAgentPaths("project", dir.path);

    await expect(hostRuns(paths, {})).rejects.toMatchObject({ code: "VALIDATION" });
    await expect(hostRuns(paths, null)).rejects.toMatchObject({ code: "VALIDATION" });
    await expect(hostRuns(paths, { threadIds: ["../escape"] })).rejects.toMatchObject({ code: "VALIDATION" });
    await expect(hostRuns(paths, { threadIds: Array.from({ length: 1001 }, (_, i) => `t${i}`) })).rejects.toMatchObject(
      {
        code: "VALIDATION",
      },
    );
  });
});
