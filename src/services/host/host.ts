import { ConflictError, NotFoundError } from "../errors/errors.js";
import { mapInOrder } from "../in-order/in-order.js";
import { listKnownProjects } from "../known-project/known-project.js";
import { listThreads } from "../thread/thread-list.js";
import { LOCAL_HOST, type ThreadRecord } from "../thread/thread-types.js";
import { rcPath, readRc, writeRc } from "../user-rc/user-rc.js";
import type { ServiceContext } from "../workspace/workspace.js";
import { type Host, type HostInput, hostView, rcHosts, validateHostInput } from "./host-rules.js";

export type { Host, HostInput } from "./host-rules.js";

export interface RemoveHostInput {
  readonly id: string;
  /** Also remove the clone and the worktrees on the host. No clone exists on a host yet, so it does no work now. */
  readonly purge?: boolean;
}

export interface RemovedHost extends Host {
  readonly purge: boolean;
}

/** One active Thread on a host, in a known Project. */
interface ActiveThread {
  readonly project: string;
  readonly id: string;
}

const ACTIVE_STATUSES: ReadonlySet<ThreadRecord["status"]> = new Set(["pending", "running"]);

/** The worker hosts of the user, in the order of `~/.rowblyrc.json`. */
export async function listHosts(ctx: ServiceContext = {}): Promise<Host[]> {
  const file = rcPath(ctx);

  return rcHosts(await readRc(file), file).map(hostView);
}

/** Adds a worker host at the end of the list. A new host is on. */
export async function addHost(input: HostInput, ctx: ServiceContext = {}): Promise<Host> {
  const file = rcPath(ctx);
  const rc = await readRc(file);
  const hosts = rcHosts(rc, file);

  validateHostInput(input);

  if (hosts.some((host) => host.id === input.id)) {
    throw new ConflictError(`Host "${input.id}" exists`, { hint: "Remove the host first, or use a different ID." });
  }

  const host: Host = { id: input.id, ssh: input.ssh, maxWorkers: input.maxWorkers, enabled: true };

  await writeRc(file, { ...rc, hosts: [...hosts, host] });

  return host;
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

/** The `pending` and `running` Threads on the host, in each known Project that is not missing. */
async function activeThreadsOn(id: string, ctx: ServiceContext): Promise<ActiveThread[]> {
  const projects = (await listKnownProjects(ctx)).filter((project) => !project.missing);
  const lists = await mapInOrder(projects, (project) => activeThreadsIn(project.path, id, ctx));

  return lists.flat();
}

async function activeThreadsIn(project: string, id: string, ctx: ServiceContext): Promise<ActiveThread[]> {
  const { threads } = await listThreads({}, { ...ctx, cwd: project });

  return threads
    .filter((thread) => ACTIVE_STATUSES.has(thread.status) && (thread.host ?? LOCAL_HOST) === id)
    .map((thread) => ({ project, id: thread.id }));
}
