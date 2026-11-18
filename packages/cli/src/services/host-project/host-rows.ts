import { NotFoundError } from "../errors/errors.js";
import { type Host, type HostLastCheck, hostProjectRecord, hostView, rcHosts } from "../host/host-rules.js";
import { rcPath, readRc } from "../user-rc/user-rc.js";
import { findProject, type ServiceContext } from "../workspace/workspace.js";

/** One row of the host list of Settings: the host, its use by the current Project and its last check. */
export interface HostRow {
  readonly host: Host;
  /** `true` when the host uses the current Project. Outside a Project, it is `false`. */
  readonly usedByProject: boolean;
  /** The summary of the last check, or `null` before the first check. */
  readonly lastCheck: HostLastCheck | null;
}

/** The root of the current Project, or `undefined` outside a Project. */
async function projectRoot(ctx: ServiceContext): Promise<string | undefined> {
  try {
    return (await findProject(ctx)).root;
  } catch (error) {
    if (error instanceof NotFoundError) {
      return undefined;
    }

    throw error;
  }
}

/** The rows of the worker hosts, in the order of `~/.rowblyrc.json`. It reads only local files and opens no SSH. */
export async function hostRows(ctx: ServiceContext = {}): Promise<HostRow[]> {
  const file = rcPath(ctx);
  const hosts = rcHosts(await readRc(file), file);
  const root = await projectRoot(ctx);

  return hosts.map((host) => ({
    host: hostView(host),
    usedByProject: root !== undefined && hostProjectRecord(host, root) !== undefined,
    lastCheck: host.lastCheck ?? null,
  }));
}
