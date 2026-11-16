import { ConflictError, NotFoundError, ValidationError } from "../errors/errors.js";
import { type HostEntry, type HostProject, hostProjectRecord, hostProjects, rcHosts } from "../host/host-rules.js";
import { activeThreadsIn } from "../host/host-threads.js";
import type { HostTransport } from "../host-transport/host-transport.js";
import { createSshTransport } from "../host-transport/ssh-transport.js";
import { rcPath, readRc, type UserRc, writeRc } from "../user-rc/user-rc.js";
import { findProject, type ServiceContext } from "../workspace/workspace.js";
import { type CloneStatus, cloneOnHost, cloneStatus, isCleanClone } from "./host-clone.js";
import { managedClonePath, remoteClonePath, validateRemoteToken } from "./host-paths.js";
import { localOrigin } from "./local-origin.js";

export { remoteWorktreesDir } from "./host-paths.js";

export interface UseHostInput {
  readonly id: string;
  /** An existing clone on the host. Without it, Rowbly uses its managed folder. */
  readonly path?: string;
}

/** The connection that `useHost` uses. Tests give a fake transport. */
export interface UseHostDeps {
  readonly transportFor?: (target: string) => HostTransport;
}

/** The result of `useHost`: the record, the host and the URL. `cloned` is `true` when this call made the clone. */
export interface UsedHost extends HostProject {
  readonly host: string;
  readonly url: string;
  readonly cloned: boolean;
}

export interface UnusedHost extends HostProject {
  readonly host: string;
}

interface HostFile {
  readonly file: string;
  readonly rc: UserRc;
  readonly hosts: readonly HostEntry[];
}

interface UsePlan {
  readonly host: HostEntry;
  readonly root: string;
  readonly url: string;
  readonly path: string;
  readonly managed: boolean;
}

async function readHosts(ctx: ServiceContext): Promise<HostFile> {
  const file = rcPath(ctx);
  const rc = await readRc(file);

  return { file, rc, hosts: rcHosts(rc, file) };
}

function findHost(hosts: readonly HostEntry[], id: string): HostEntry {
  const host = hosts.find((entry) => entry.id === id);

  if (!host) {
    throw new NotFoundError(`Host "${id}" not found`, { details: { hosts: hosts.map((entry) => entry.id) } });
  }

  return host;
}

function assertNotUsed(host: HostEntry, root: string): void {
  const record = hostProjectRecord(host, root);

  if (record) {
    throw new ConflictError(`Host "${host.id}" already uses this Project`, {
      hint: `Run \`rowbly host unuse ${host.id}\` first.`,
      details: { root, path: record.path, managed: record.managed },
    });
  }
}

function withHost(hosts: readonly HostEntry[], host: HostEntry): readonly HostEntry[] {
  return hosts.map((entry) => (entry.id === host.id ? host : entry));
}

/** Reads the host, the Project and the URL, and checks them before any remote command. */
async function planUse(input: UseHostInput, ctx: ServiceContext): Promise<UsePlan> {
  const { root } = await findProject(ctx);
  const { hosts } = await readHosts(ctx);
  const host = findHost(hosts, input.id);

  assertNotUsed(host, root);

  const url = await localOrigin(root);
  const path = input.path === undefined ? managedClonePath(root) : remoteClonePath(input.path);

  validateRemoteToken("origin", url);

  return { host, root, url, path, managed: input.path === undefined };
}

function record(plan: UsePlan): HostProject {
  return { root: plan.root, path: plan.path, managed: plan.managed };
}

/** Clones into the managed folder, or uses the clone that is there. Gives `true` when it made the clone. */
async function prepareManaged(transport: HostTransport, plan: UsePlan): Promise<boolean> {
  const status = await cloneStatus(transport, record(plan), plan.url);

  if (status.state === "ok") {
    return false;
  }

  if (status.state !== "missing") {
    throw new ConflictError(`The managed folder ${plan.path} on ${plan.host.ssh} is not a clone of ${plan.url}`, {
      hint: "Move or remove the folder on the host, or use an existing clone with --path.",
      details: { ...status },
    });
  }

  await cloneOnHost(transport, { url: plan.url, path: plan.path, ssh: plan.host.ssh });

  return true;
}

function invalidClone(plan: UsePlan, message: string, status: CloneStatus): ValidationError {
  return new ValidationError(`${plan.path} on ${plan.host.ssh} ${message}`, {
    details: { ...status, issues: [{ path: ["path"], message: `The folder ${message}` }] },
  });
}

/** Checks that `--path` is a clean clone of the same repository. */
async function checkExisting(transport: HostTransport, plan: UsePlan): Promise<void> {
  const status = await cloneStatus(transport, record(plan), plan.url);

  if (status.state === "missing" || status.state === "not-a-repository") {
    throw invalidClone(plan, "is not a Git work tree", status);
  }

  if (status.state === "different-repository") {
    throw invalidClone(plan, `is not a clone of ${plan.url}`, status);
  }

  if (!(await isCleanClone(transport, plan.path))) {
    throw invalidClone(plan, "has changes (git status --porcelain is not empty)", status);
  }
}

/** Writes the record. It reads the file again, because the clone can take minutes. */
async function writeRecord(plan: UsePlan, ctx: ServiceContext): Promise<void> {
  const { file, rc, hosts } = await readHosts(ctx);
  const host = findHost(hosts, plan.host.id);

  assertNotUsed(host, plan.root);

  const projects = [...hostProjects(host), record(plan)];

  await writeRc(file, { ...rc, hosts: withHost(hosts, { ...host, projects }) });
}

/**
 * Turns a worker host on for the current Project. Without `path`, it clones the `origin` repository into the managed
 * folder on the host, or uses the clone that is there. With `path`, it uses that clone. It writes the record only
 * after the remote steps pass.
 */
export async function useHost(
  input: UseHostInput,
  ctx: ServiceContext = {},
  deps: UseHostDeps = {},
): Promise<UsedHost> {
  const plan = await planUse(input, ctx);
  const transport = (deps.transportFor ?? ((target) => createSshTransport({ target })))(plan.host.ssh);
  const cloned = plan.managed ? await prepareManaged(transport, plan) : false;

  if (!plan.managed) {
    await checkExisting(transport, plan);
  }

  await writeRecord(plan, ctx);

  return { host: plan.host.id, ...record(plan), url: plan.url, cloned };
}

async function assertNoActiveThreads(id: string, root: string, ctx: ServiceContext): Promise<void> {
  const active = await activeThreadsIn(root, id, ctx);

  if (active.length > 0) {
    throw new ConflictError(`Host "${id}" has ${active.length} active Thread(s) in this Project`, {
      hint: "Wait for the Threads to end, or cancel them, then run the command again.",
      details: { threads: active },
    });
  }
}

/** Turns a worker host off for the current Project. It removes only the record. The clone stays on the host. */
export async function unuseHost(input: { readonly id: string }, ctx: ServiceContext = {}): Promise<UnusedHost> {
  const { root } = await findProject(ctx);
  const { file, rc, hosts } = await readHosts(ctx);
  const host = findHost(hosts, input.id);
  const found = hostProjectRecord(host, root);

  if (!found) {
    throw new NotFoundError(`Host "${input.id}" does not use this Project`, { details: { root } });
  }

  await assertNoActiveThreads(input.id, root, ctx);

  const projects = hostProjects(host).filter((project) => project !== found);

  await writeRc(file, { ...rc, hosts: withHost(hosts, { ...host, projects }) });

  return { host: input.id, ...found };
}

/** The clone of the current Project on the host, or `undefined` when the host does not use the Project. */
export async function hostProjectFor(hostId: string, ctx: ServiceContext = {}): Promise<HostProject | undefined> {
  const { root } = await findProject(ctx);
  const { hosts } = await readHosts(ctx);

  return hostProjectRecord(findHost(hosts, hostId), root);
}
