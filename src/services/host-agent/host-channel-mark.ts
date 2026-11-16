// The live mark of the `host attach` channel. A worker CLI reads it before it writes a fetch request, so that a read
// on a host without a channel fails at once.

import { readFile, rm } from "node:fs/promises";
import { type Owner, type OwnerProbe, probeOwner, readOwner } from "../factory-ownership/ownership-lock.js";
import { writeFileAtomic } from "../files/files.js";
import { ensurePrivateDir, type HostAgentPaths } from "./host-agent-paths.js";

/** Writes the mark with the process identity of the channel. A later channel replaces the mark. */
export async function writeChannelMark(paths: HostAgentPaths, owner: Owner): Promise<void> {
  await ensurePrivateDir(paths.dir);
  await writeFileAtomic(paths.channel, `${JSON.stringify(owner)}\n`, { mode: 0o600 });
}

function markToken(text: string): unknown {
  try {
    return (JSON.parse(text) as { token?: unknown } | null)?.token;
  } catch {
    return undefined;
  }
}

/** Removes the mark when it still holds the token. The mark of a later channel stays. */
export async function removeChannelMark(paths: HostAgentPaths, token: string): Promise<void> {
  const text = await readFile(paths.channel, "utf8").catch(() => "");

  if (markToken(text) === token) {
    await rm(paths.channel, { force: true });
  }
}

/**
 * Tells whether a channel is live: the mark exists, and the probe does not say that its process is dead. An
 * uncertain probe counts as live, as for the claim of the agent, because a host without process identities (macOS)
 * always gives an uncertain probe.
 */
export async function channelLive(paths: HostAgentPaths, probe: OwnerProbe = probeOwner): Promise<boolean> {
  const owner = await readOwner(paths.channel).catch(() => undefined);

  if (!owner) {
    return false;
  }

  return (await probe(owner)) !== "dead";
}
