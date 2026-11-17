import type { PlacementPolicy } from "../factory-settings/placement-settings.js";
import { LOCAL_HOST } from "../thread/thread-types.js";
import type { HostSlots } from "./host-slots.js";

/** The Git facts of the worktree of a Story on one host. */
interface WorktreeFacts {
  readonly host: string;
  /** True when all commits of the worktree are on `origin`. */
  readonly pushed: boolean;
  /** True when the worktree has no uncommitted changes. */
  readonly clean: boolean;
}

/** The facts of a Story that the placement uses. */
export interface StoryPlacementFacts {
  /** The host of the last worker Thread of the Story. */
  readonly lastHost?: string;
  /** The facts of the worktree of the Story, when they are known. */
  readonly worktree?: WorktreeFacts;
}

export interface PlacementInput {
  readonly policy: PlacementPolicy;
  /** The slots of `local` and of each worker host, in the order of the host list. */
  readonly hosts: readonly HostSlots[];
  /** The providers of each worker host. A host without an entry has no known providers. */
  readonly providers: ReadonlyMap<string, readonly string[]>;
  /** The provider of the worker model, when it is known. */
  readonly provider?: string;
  readonly story: StoryPlacementFacts;
  /** The requested host. */
  readonly requested?: string;
}

/** A host for the worker, or no host with the reason. */
export type Placement =
  | { readonly host: string; readonly reason?: undefined }
  | { readonly host?: undefined; readonly reason: string };

/** The hosts that the rules permit, or the reason that no host is permitted. */
type Permitted =
  | { readonly hosts: readonly HostSlots[]; readonly rule?: string }
  | { readonly hosts?: undefined; readonly reason: string };

/** Gives the reason that a host cannot take the worker, or undefined for an eligible host. */
function ineligibleReason(input: PlacementInput, host: HostSlots): string | undefined {
  if (host.state !== "connected") {
    return `host ${host.id} is ${host.state}`;
  }

  if (host.free < 1) {
    return `worker capacity is full on host ${host.id}`;
  }

  if (host.id === LOCAL_HOST) {
    return undefined;
  }

  if (input.provider === undefined) {
    return `the provider of the worker model is not known, so host ${host.id} cannot take it`;
  }

  return input.providers.get(host.id)?.includes(input.provider)
    ? undefined
    : `host ${host.id} does not have the provider ${input.provider}`;
}

/** Gives the reason that a host ID cannot take the worker. An ID that is not in the list is unknown. */
function hostReason(input: PlacementInput, id: string): string | undefined {
  const host = input.hosts.find((entry) => entry.id === id);

  return host ? ineligibleReason(input, host) : `unknown host ${id}`;
}

/** Tells if the Story has a local worktree with commits that are not pushed or with uncommitted changes. */
function hasUnpushedWork(story: StoryPlacementFacts): boolean {
  const { worktree } = story;

  return worktree?.host === LOCAL_HOST && (!worktree.pushed || !worktree.clean);
}

/** Tells if the old worktree of the Story on its last host is known to be pushed and clean. */
function canMove(story: StoryPlacementFacts): boolean {
  const { worktree } = story;

  return !!worktree && worktree.host === story.lastHost && worktree.pushed && worktree.clean;
}

function only(input: PlacementInput, id: string, rule: string): Permitted {
  const reason = hostReason(input, id);
  const host = input.hosts.find((entry) => entry.id === id);

  return reason || !host ? { reason: `${rule}: ${reason}` } : { hosts: [host], rule };
}

/** Applies the eligibility, the unpushed-work rule and the affinity, in this order. */
function permittedHosts(input: PlacementInput): Permitted {
  const { story } = input;

  if (hasUnpushedWork(story)) {
    return only(input, LOCAL_HOST, "the Story has unpushed or uncommitted work, so only local is permitted");
  }

  if (story.lastHost !== undefined && hostReason(input, story.lastHost) === undefined) {
    return only(input, story.lastHost, `the Story stays on host ${story.lastHost}`);
  }

  const eligible = input.hosts.filter((host) => ineligibleReason(input, host) === undefined);

  if (eligible.length === 0) {
    return { reason: `no host can take work: ${input.hosts.map((host) => ineligibleReason(input, host)).join("; ")}` };
  }

  if (story.lastHost !== undefined && !canMove(story)) {
    return {
      reason: `the Story waits for host ${story.lastHost}, because its worktree there is not known to be pushed and clean: ${hostReason(input, story.lastHost)}`,
    };
  }

  return { hosts: eligible };
}

/** Puts the host with the most free slots first. A stable sort keeps the input order of a tie. */
function byFree(hosts: readonly HostSlots[]): HostSlots[] {
  return hosts.toSorted((a, b) => b.free - a.free);
}

/** Orders the permitted hosts by the policy. The first host gets the worker. */
function byPolicy(policy: PlacementPolicy, hosts: readonly HostSlots[]): HostSlots[] {
  const local = hosts.filter((host) => host.id === LOCAL_HOST);
  const remote = byFree(hosts.filter((host) => host.id !== LOCAL_HOST));

  if (policy === "prefer-local") {
    return [...local, ...remote];
  }

  if (policy === "prefer-remote") {
    return [...remote, ...local];
  }

  return byFree([...local, ...remote]);
}

/** Checks a requested host against the permitted hosts. The policy does not apply to it. */
function placeRequested(input: PlacementInput, permitted: Permitted, requested: string): Placement {
  const reason = hostReason(input, requested);

  if (reason) {
    return { reason: `requested ${reason}` };
  }

  if (!permitted.hosts) {
    return { reason: `requested host ${requested} is refused: ${permitted.reason}` };
  }

  return permitted.hosts.some((host) => host.id === requested)
    ? { host: requested }
    : { reason: `requested host ${requested} is refused: ${permitted.rule ?? "the rules do not permit it"}` };
}

/**
 * Selects the host of a new worker. A host is eligible when it is connected, has a free slot and has the provider of
 * the worker model. Unpushed local work stays on `local`, and a Story stays on the host of its last worker. The
 * policy orders the other eligible hosts. It does no I/O.
 */
export function placeWorker(input: PlacementInput): Placement {
  const permitted = permittedHosts(input);

  if (input.requested !== undefined) {
    return placeRequested(input, permitted, input.requested);
  }

  if (!permitted.hosts) {
    return { reason: permitted.reason };
  }

  const first = byPolicy(input.policy, permitted.hosts)[0];

  return first ? { host: first.id } : { reason: "no host can take work" };
}
