import { describe, expect, it } from "vitest";
import { localVersions } from "../host-transport/host-transport.js";
import { useTempDir } from "../test-project/test-project.js";
import { submitHostCommand } from "./host-agent-control.js";
import { hostAgentPaths } from "./host-agent-paths.js";
import { hostPing } from "./host-ping.js";
import { writeSlotLimit } from "./host-slots.js";

describe("hostPing", () => {
  const home = useTempDir();

  it("gives the versions, the agent phase, the slots and the pending commands without a start of the agent", async () => {
    const paths = hostAgentPaths("p1", home.path);

    expect(await hostPing(paths, home.path)).toEqual({
      ...localVersions(),
      agent: "stopped",
      slots: { used: 0, max: expect.any(Number) },
      pending: 0,
    });

    await writeSlotLimit(3, home.path);
    await submitHostCommand(paths, JSON.stringify({ version: 1, id: "r1", type: "stop" }));

    expect(await hostPing(paths, home.path)).toMatchObject({
      agent: "stopped",
      slots: { used: 0, max: 3 },
      pending: 1,
    });
  });
});
