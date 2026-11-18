// The answer of `rowbly host ping`: the versions of this Rowbly and the state of the host agent. It starts nothing.

import type { OwnerProbe } from "../factory-ownership/ownership-lock.js";
import { type HostVersions, localVersions } from "../host-transport/host-transport.js";
import { agentStatus, type HostAgentPhase } from "./host-agent-claim.js";
import { pendingCommandCount } from "./host-agent-control.js";
import type { HostAgentPaths } from "./host-agent-paths.js";
import { type SlotUsage, slotUsage } from "./host-slots.js";

/** The answer of one heartbeat: the versions, and the values of the status frame of the agent. */
export interface HostPingAnswer extends HostVersions {
  readonly agent: HostAgentPhase;
  readonly slots: SlotUsage;
  readonly pending: number;
}

/** Gives the versions of this Rowbly and the state of the host agent of the Project. It does not start the agent. */
export async function hostPing(paths: HostAgentPaths, home?: string, probe?: OwnerProbe): Promise<HostPingAnswer> {
  const status = await agentStatus(paths, probe);
  const slots = await slotUsage(home);
  const pending = await pendingCommandCount(paths);

  return { ...localVersions(), agent: status.agent, slots, pending };
}
