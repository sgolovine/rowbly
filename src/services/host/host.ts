import { ConflictError, NotFoundError } from "../errors/errors.js";
import { ensureHostVersion, type HostVersionResult } from "../host-install/host-install.js";
import { HostInstallFailedError } from "../host-install/host-install-errors.js";
import { type LocalBuild, localBuild } from "../host-install/local-build.js";
import type { HostTransport } from "../host-transport/host-transport.js";
import { createSshTransport } from "../host-transport/ssh-transport.js";
import { rcPath, readRc, writeRc } from "../user-rc/user-rc.js";
import type { ServiceContext } from "../workspace/workspace.js";
import { type Host, type HostInput, hostView, rcHosts, validateHostInput } from "./host-rules.js";
import { activeThreadsOn } from "./host-threads.js";

export type { Host, HostInput, HostProject } from "./host-rules.js";

/** The connection and the build that `addHost` uses. Tests give a fake transport and a fake build. */
export interface AddHostDeps {
  readonly transportFor?: (target: string) => HostTransport;
  readonly build?: () => Promise<LocalBuild>;
}

/** A recorded host with the result of the install of the Rowbly version. */
export interface AddedHost extends Host {
  readonly install: HostVersionResult;
}

export interface RemoveHostInput {
  readonly id: string;
  /** Also remove the clone and the worktrees on the host. A later change adds this work, so it does no work now. */
  readonly purge?: boolean;
}

export interface RemovedHost extends Host {
  readonly purge: boolean;
}

/** The worker hosts of the user, in the order of `~/.rowblyrc.json`. */
export async function listHosts(ctx: ServiceContext = {}): Promise<Host[]> {
  const file = rcPath(ctx);

  return rcHosts(await readRc(file), file).map(hostView);
}

function assertNewHost(hosts: readonly { readonly id: string }[], id: string): void {
  if (hosts.some((host) => host.id === id)) {
    throw new ConflictError(`Host "${id}" exists`, { hint: "Remove the host first, or use a different ID." });
  }
}

/** Checks Node on the host and installs the Rowbly build there. It throws when the host cannot run the build. */
async function installOnHost(input: HostInput, deps: AddHostDeps): Promise<HostVersionResult> {
  const transport = (deps.transportFor ?? ((target) => createSshTransport({ target })))(input.ssh);
  const build = await (deps.build ?? localBuild)();
  const install = await ensureHostVersion(transport, { build });

  if (install.state !== "ready") {
    throw new HostInstallFailedError(`Rowbly ${install.buildId} could not be installed on ${input.ssh}.`, {
      details: { install },
      hint: "Make sure that npm works on the host in a non-interactive SSH session, then add the host again.",
    });
  }

  return install;
}

/**
 * Adds a worker host at the end of the list. A new host is on. It checks Node and installs the exact Rowbly build
 * on the host first. When that fails, the file does not change.
 */
export async function addHost(input: HostInput, ctx: ServiceContext = {}, deps: AddHostDeps = {}): Promise<AddedHost> {
  const file = rcPath(ctx);

  validateHostInput(input);
  assertNewHost(rcHosts(await readRc(file), file), input.id);

  const install = await installOnHost(input, deps);
  // The install can take minutes, so read the file again to keep a change of a different process.
  const rc = await readRc(file);
  const hosts = rcHosts(rc, file);

  assertNewHost(hosts, input.id);

  const host: Host = { id: input.id, ssh: input.ssh, maxWorkers: input.maxWorkers, enabled: true };

  await writeRc(file, { ...rc, hosts: [...hosts, host] });

  return { ...host, install };
}

/** Removes a worker host. It refuses while a Thread of a known Project is active on the host. */
export async function removeHost(input: RemoveHostInput, ctx: ServiceContext = {}): Promise<RemovedHost> {
  const file = rcPath(ctx);
  const rc = await readRc(file);
  const hosts = rcHosts(rc, file);
  const host = hosts.find((entry) => entry.id === input.id);

  if (!host) {
    throw new NotFoundError(`Host "${input.id}" not found`, { details: { hosts: hosts.map((entry) => entry.id) } });
  }

  await assertNoActiveThreads(input.id, ctx);
  await writeRc(file, { ...rc, hosts: hosts.filter((entry) => entry !== host) });

  return { ...hostView(host), purge: input.purge === true };
}

async function assertNoActiveThreads(id: string, ctx: ServiceContext): Promise<void> {
  const active = await activeThreadsOn(id, ctx);

  if (active.length > 0) {
    throw new ConflictError(`Host "${id}" has ${active.length} active Thread(s)`, {
      hint: "Wait for the Threads to end, or cancel them, then remove the host again.",
      details: { threads: active },
    });
  }
}
