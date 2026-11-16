import { mapInOrder } from "../in-order/in-order.js";
import { listKnownProjects } from "../known-project/known-project.js";
import { listThreads } from "../thread/thread-list.js";
import { LOCAL_HOST, type ThreadRecord } from "../thread/thread-types.js";
import type { ServiceContext } from "../workspace/workspace.js";

/** One active Thread on a host, in a known Project. */
export interface ActiveThread {
  readonly project: string;
  readonly id: string;
}

const ACTIVE_STATUSES: ReadonlySet<ThreadRecord["status"]> = new Set(["pending", "running"]);

/** The `pending` and `running` Threads on the host, in each known Project that is not missing. */
export async function activeThreadsOn(id: string, ctx: ServiceContext): Promise<ActiveThread[]> {
  const projects = (await listKnownProjects(ctx)).filter((project) => !project.missing);
  const lists = await mapInOrder(projects, (project) => activeThreadsIn(project.path, id, ctx));

  return lists.flat();
}

/** The `pending` and `running` Threads on the host, in one Project. */
export async function activeThreadsIn(project: string, id: string, ctx: ServiceContext): Promise<ActiveThread[]> {
  const { threads } = await listThreads({}, { ...ctx, cwd: project });

  return threads
    .filter((thread) => ACTIVE_STATUSES.has(thread.status) && (thread.host ?? LOCAL_HOST) === id)
    .map((thread) => ({ project, id: thread.id }));
}
