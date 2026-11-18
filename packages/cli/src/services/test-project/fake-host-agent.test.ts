import { describe, expect, it } from "vitest";
import type { HostWorkRunner } from "../host-agent/host-agent-work.js";
import { createFakeHostAgent } from "./fake-host-agent.js";
import { useTempDir } from "./test-project.js";

const runner: HostWorkRunner = {
  start: async () => {
    throw new Error("The test starts no work");
  },
};

describe("fake host agent", () => {
  const home = useTempDir();

  it("answers the host commands with the host services in the home folder", async () => {
    const host = createFakeHostAgent({ projectId: "p1", home: home.path, runner });
    const rowbly = "/opt/rowbly/bin/rowbly";

    const paths = await host.transport.request([rowbly, "host", "run-paths", "p1"], {
      threadId: "t1",
      storyId: "ROW-1",
      clone: "repo",
    });
    expect(paths).toMatchObject({ exitCode: 0, value: { worktree: `${home.path}/repo-worktrees/ROW-1` } });

    const unknown = await host.transport.request([rowbly, "host", "nothing", "p1"], {});
    expect(unknown.exitCode).toBe(1);

    // The inbound updates go to the real host service, which refuses a Thread that is not prepared.
    const inbound = await host.transport.request([rowbly, "host", "inbound", "p1"], { threadId: "t1", updates: [] });
    expect(inbound).toMatchObject({ exitCode: 1, stderr: expect.stringContaining("is not prepared on this host") });

    expect(await host.transport.request([rowbly, "host", "outbox", "p1"], { afterSeq: 0 })).toMatchObject({
      exitCode: 0,
      value: { entries: [] },
    });
    host.failOutbox(true);
    await expect(host.transport.request([rowbly, "host", "outbox", "p1"], { afterSeq: 0 })).rejects.toMatchObject({
      code: "HOST_UNREACHABLE",
    });
    expect(host.calls.map((call) => call[2])).toEqual(["run-paths", "nothing", "inbound", "outbox", "outbox"]);
    await host.stop();
  });
});
