import { rcPath, readRc, writeRc } from "../user-rc/user-rc.js";
import type { ServiceContext } from "../workspace/workspace.js";
import { type HostLastCheck, rcHosts } from "./host-rules.js";

/** The parts of a check result that the summary uses. */
interface CheckOutcome {
  readonly ready: boolean;
  readonly items: readonly { readonly id: string; readonly state: string }[];
}

/** The summary of a check at the time of `ctx`. */
export function lastCheckOf(check: CheckOutcome, ctx: ServiceContext): HostLastCheck {
  const now = ctx.now?.() ?? new Date();
  const failed = check.items.filter((item) => item.state === "fail").map((item) => item.id);

  return { at: now.toISOString(), ready: check.ready, failed };
}

/**
 * Writes the summary of a check to the host entry of `~/.rowblyrc.json`. It reads the file again, because the check
 * takes time. When the host is not in the file, for example because a different process removed it, it writes nothing.
 */
export async function recordLastCheck(hostId: string, check: CheckOutcome, ctx: ServiceContext = {}): Promise<void> {
  const file = rcPath(ctx);
  const rc = await readRc(file);
  const hosts = rcHosts(rc, file);

  if (!hosts.some((entry) => entry.id === hostId)) {
    return;
  }

  const lastCheck = lastCheckOf(check, ctx);

  await writeRc(file, { ...rc, hosts: hosts.map((entry) => (entry.id === hostId ? { ...entry, lastCheck } : entry)) });
}
