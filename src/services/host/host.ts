import { ConflictError, NotFoundError, ValidationError } from "../errors/errors.js";
import { type HostCheck, type HostCheckDeps, runHostCheck } from "../host-check/host-check.js";
import { ensureHostVersion, type HostVersionResult } from "../host-install/host-install.js";
import { HostInstallFailedError } from "../host-install/host-install-errors.js";
import { type LocalBuild, localBuild } from "../host-install/local-build.js";
import type { HostTransport } from "../host-transport/host-transport.js";
import { createSshTransport } from "../host-transport/ssh-transport.js";
import { rcPath, readRc, writeRc } from "../user-rc/user-rc.js";
import type { ServiceContext } from "../workspace/workspace.js";
import {
  type Host,
  type HostEntry,
  type HostInput,
  type HostUpdate,
  hostView,
  rcHosts,
  validateHostInput,
  validateMaxWorkers,
} from "./host-rules.js";
import { activeThreadsOn } from "./host-threads.js";

export type { Host, HostInput, HostLastCheck, HostProject, HostUpdate } from "./host-rules.js";

/** The connection, the build and the check facts that `addHost` uses. Tests give a fake transport and a fake build. */
export type AddHostDeps = HostCheckDeps;

/** A recorded host with the result of the install of the Rowbly version and the result of the check. */
export interface AddedHost extends Host {
  readonly install: HostVersionResult;
  readonly check: HostCheck;
}

/** The result of the install, with the connection and the build for the check. */
interface HostInstall {
  readonly install: HostVersionResult;
  readonly transport: HostTransport;
  readonly build: LocalBuild;
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
async function installOnHost(input: HostInput, deps: AddHostDeps): Promise<HostInstall> {
  const transport = (deps.transportFor ?? ((target) => createSshTransport({ target })))(input.ssh);
  const build = await (deps.build ?? localBuild)();
  const install = await ensureHostVersion(transport, { build });

  if (install.state !== "ready") {
    throw new HostInstallFailedError(`Rowbly ${install.buildId} could not be installed on ${input.ssh}.`, {
      details: { install },
      hint: "Make sure that npm works on the host in a non-interactive SSH session, then add the host again.",
    });
  }

  return { install, transport, build };
}

/**
 * Adds a worker host at the end of the list. A new host is on. It checks Node and installs the exact Rowbly build
 * on the host first. When that fails, the file does not change. After the write, it checks the host. A failed item
 * of the check does not make the add fail.
 */
export async function addHost(input: HostInput, ctx: ServiceContext = {}, deps: AddHostDeps = {}): Promise<AddedHost> {
  const file = rcPath(ctx);

  validateHostInput(input);
  assertNewHost(rcHosts(await readRc(file), file), input.id);

  const { install, transport, build } = await installOnHost(input, deps);
  // The install can take minutes, so read the file again to keep a change of a different process.
  const rc = await readRc(file);
  const hosts = rcHosts(rc, file);

  assertNewHost(hosts, input.id);

  const host: Host = { id: input.id, ssh: input.ssh, maxWorkers: input.maxWorkers, enabled: true };

  await writeRc(file, { ...rc, hosts: [...hosts, host] });

  const check = await runHostCheck({ hostId: host.id, transport, build }, ctx, deps);

  return { ...host, install, check };
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

/** Throws a `ValidationError` when the update changes nothing or has a bad worker limit. */
function validateUpdate(input: HostUpdate): void {
  if (input.maxWorkers === undefined && input.enabled === undefined) {
    throw new ValidationError("Give a new worker limit or a new on/off state", {
      hint: "Use --max-workers <n>, --enable or --disable.",
    });
  }

  if (input.maxWorkers !== undefined) {
    validateMaxWorkers(input.maxWorkers);
  }
}

function changedHost(host: HostEntry, input: HostUpdate): HostEntry {
  return {
    ...host,
    ...(input.maxWorkers === undefined ? {} : { maxWorkers: input.maxWorkers }),
    ...(input.enabled === undefined ? {} : { enabled: input.enabled }),
  };
}

/** Changes the worker limit and/or the on/off state of a worker host. The other keys of the entry and the file stay. */
export async function updateHost(input: HostUpdate, ctx: ServiceContext = {}): Promise<Host> {
  validateUpdate(input);

  const file = rcPath(ctx);
  const rc = await readRc(file);
  const hosts = rcHosts(rc, file);
  const host = hosts.find((entry) => entry.id === input.id);

  if (!host) {
    throw new NotFoundError(`Host "${input.id}" not found`, { details: { hosts: hosts.map((entry) => entry.id) } });
  }

  const changed = changedHost(host, input);

  await writeRc(file, { ...rc, hosts: hosts.map((entry) => (entry === host ? changed : entry)) });

  return hostView(changed);
}
