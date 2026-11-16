import { describe, expect, it } from "vitest";
import { newOwner } from "../factory-ownership/ownership-lock.js";
import { useTempDir } from "../test-project/test-project.js";
import {
  acquireAgentClaim,
  agentStatus,
  liveAgent,
  readAgentClaim,
  releaseAgentClaim,
  writeAgentState,
} from "./host-agent-claim.js";
import { hostAgentPaths } from "./host-agent-paths.js";

describe("host agent claim", () => {
  const home = useTempDir();
  const paths = () => hostAgentPaths("p1", home.path);
  const state = (owner: Awaited<ReturnType<typeof newOwner>>, phase: "running" | "stopping" | "stopped") => ({
    version: 1 as const,
    owner,
    phase,
    startedAt: owner.startedAt,
    updatedAt: owner.startedAt,
    active: [],
  });

  it("gives no live agent and the phase stopped without a claim", async () => {
    expect(await liveAgent(paths())).toBeUndefined();
    expect(await agentStatus(paths())).toEqual({ agent: "stopped", owner: null });
  });

  it("refuses a second claim while the holder is alive, and releases only with the token", async () => {
    const first = await newOwner();
    const second = await newOwner();

    expect(await acquireAgentClaim(paths(), first)).toEqual({ acquired: true, owner: first });
    expect(await acquireAgentClaim(paths(), second)).toEqual({ acquired: false, owner: first });
    expect(await releaseAgentClaim(paths(), second.token)).toBe(false);
    expect(await releaseAgentClaim(paths(), first.token)).toBe(true);
    expect(await readAgentClaim(paths())).toBeUndefined();
  });

  it("gives the phase of the live holder, and a holder that wrote stopped is not live", async () => {
    const owner = await newOwner();
    await acquireAgentClaim(paths(), owner);

    await writeAgentState(paths(), state(owner, "stopping"));
    expect(await agentStatus(paths())).toEqual({ agent: "stopping", owner });

    await writeAgentState(paths(), state(owner, "stopped"));
    expect(await liveAgent(paths())).toBeUndefined();
    expect(await agentStatus(paths())).toEqual({ agent: "stopped", owner: null });
  });

  it("gives a dead holder as not live", async () => {
    const owner = await newOwner();
    await acquireAgentClaim(paths(), owner);

    expect(await liveAgent(paths(), async () => "dead")).toBeUndefined();
    expect(await liveAgent(paths(), async () => "uncertain")).toEqual(owner);
  });
});
