import { ConflictError } from "../errors/errors.js";
import type { ModelChoice } from "../factory-settings/factory-settings.js";
import { placementPolicy } from "../factory-settings/placement-settings.js";
import type { Story } from "../story/story.js";
import { LOCAL_HOST, type ThreadRecord } from "../thread/thread-types.js";
import { readWorktreeFacts } from "../worker-worktree/worker-worktree.js";
import { countByHost, type HostSlots, hostSlots, placementCapacity, type WorkerHostView } from "./host-slots.js";
import { getState, type Manager, type ManagerState, setState } from "./manager-state.js";
import { placeWorker, type StoryPlacementFacts } from "./placement.js";

/** The request of one placement in `start_worker`. */
export interface PlacementRequest {
  readonly story: Story;
  readonly choice?: ModelChoice;
  readonly requested?: string;
  /** All worker Threads of the Project, in the order of creation. */
  readonly threads: readonly ThreadRecord[];
}

/** Reads the worker hosts again and keeps them in the state. A manager without `workerHosts` has no worker hosts. */
export async function refreshHosts(manager: Manager): Promise<readonly WorkerHostView[]> {
  const hosts = manager.deps.workerHosts ? await manager.deps.workerHosts() : [];

  setState(manager, () => ({ hosts }));

  return hosts;
}

/** Gives the slots of `local` and of each worker host, from the active workers of the manager. */
export function managerSlots(state: Readonly<ManagerState>): HostSlots[] {
  return hostSlots(state.limit, state.hosts, countByHost([...state.active.values()].map((worker) => worker.host)));
}

/** Gives the policy limit: the total slots of the hosts that can take work. */
export function managerCapacity(state: Readonly<ManagerState>): number {
  return placementCapacity(state.limit, state.hosts);
}

/** Counts the workers of each host: the larger of the active entries and the active Thread records. */
function usedSlots(state: Readonly<ManagerState>, active: readonly ThreadRecord[]): ReadonlyMap<string, number> {
  const entries = countByHost([...state.active.values()].map((worker) => worker.host));
  const records = countByHost(active.map((thread) => thread.host ?? LOCAL_HOST));
  const ids = [...new Set([...entries.keys(), ...records.keys()])];

  return new Map(ids.map((id) => [id, Math.max(entries.get(id) ?? 0, records.get(id) ?? 0)]));
}

/** Gives the providers of each worker host with a known provider list. */
function knownProviders(hosts: readonly WorkerHostView[]): ReadonlyMap<string, readonly string[]> {
  return new Map(
    hosts.flatMap((host): [string, readonly string[]][] => (host.providers ? [[host.id, host.providers]] : [])),
  );
}

/** Reads the facts of the Story. Git runs only when a worker host is in the list. */
async function storyFacts(manager: Manager, request: PlacementRequest): Promise<StoryPlacementFacts> {
  const last = request.threads.filter((thread) => thread.storyId === request.story.id).at(-1);
  const lastHost = last ? (last.host ?? LOCAL_HOST) : undefined;

  if (getState(manager).hosts.length === 0) {
    return { lastHost };
  }

  const read = manager.deps.worktreeFacts ?? readWorktreeFacts;
  const facts = await read(manager.paths.root, request.story);

  return { lastHost, ...(facts ? { worktree: { host: LOCAL_HOST, ...facts } } : {}) };
}

/**
 * Selects the host of a new worker with the placement rules. A refused placement gives a `ConflictError` with the
 * reason. A worker host gives a `ConflictError` too when the manager has no `hostConnection`, because then it cannot
 * send a worker to a worker host.
 */
export async function placeStory(manager: Manager, request: PlacementRequest): Promise<string> {
  await refreshHosts(manager);

  const story = await storyFacts(manager, request);
  const state = getState(manager);
  const active = request.threads.filter((thread) => thread.status === "pending" || thread.status === "running");

  const placement = placeWorker({
    policy: placementPolicy(state.settings),
    hosts: hostSlots(state.limit, state.hosts, usedSlots(state, active)),
    providers: knownProviders(state.hosts),
    provider: request.choice?.provider,
    story,
    requested: request.requested,
  });

  if (!placement.host) {
    throw new ConflictError(`Cannot place the worker: ${placement.reason}`);
  }

  if (placement.host !== LOCAL_HOST && !manager.remote) {
    throw new ConflictError("Remote dispatch is not available", { details: { host: placement.host } });
  }

  return placement.host;
}
