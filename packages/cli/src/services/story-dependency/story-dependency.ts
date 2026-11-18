/** The fields of a Story that the dependency rules use. A full `Story` also agrees with this type. */
export interface DependencyStory {
  readonly id: string;
  /** A stage key. */
  readonly stage: string;
  /** The IDs of the upstream Stories. */
  readonly dependsOn: readonly string[];
}

/** The fields of a Stage that the dependency rules use, in board order. */
export interface DependencyStage {
  readonly key: string;
}

/** The kinds of problem that a `dependsOn` list can have. The kind is also the key of the error details. */
type DependencyProblemKind = "unknown" | "otherProject" | "self" | "cycle";

/** The first problem of a `dependsOn` list. */
export interface DependencyProblem {
  readonly kind: DependencyProblemKind;
  /** The IDs with the problem. For a cycle, the IDs of the cycle, with the first ID also at the end. */
  readonly ids: readonly string[];
  readonly message: string;
}

/** The upstream Story IDs of each Story, by Story ID. */
type DependencyGraph = ReadonlyMap<string, readonly string[]>;

/** `ROW-01` → `ROW`; `undefined` when the ID has no key. */
function keyOf(id: string): string | undefined {
  const at = id.lastIndexOf("-");

  return at === -1 ? undefined : id.slice(0, at);
}

function graphOf(stories: readonly DependencyStory[]): DependencyGraph {
  return new Map(stories.map((story) => [story.id, story.dependsOn]));
}

/** The path from `root` to `node`, through the node that found each node first. */
function pathTo(parents: ReadonlyMap<string, string>, root: string, node: string): string[] {
  const parent = parents.get(node);

  return node === root || parent === undefined ? [node] : [...pathTo(parents, root, parent), node];
}

/** One level of a breadth-first search from `root` for a path back to `root`. */
function searchLevel(
  graph: DependencyGraph,
  root: string,
  frontier: readonly string[],
  parents: ReadonlyMap<string, string>,
): string[] | undefined {
  if (frontier.length === 0) {
    return undefined;
  }

  const edges = frontier.flatMap((node) => (graph.get(node) ?? []).map((next): [string, string] => [next, node]));
  const closing = edges.find(([next]) => next === root);

  if (closing) {
    return [...pathTo(parents, root, closing[1]), root];
  }

  const fresh = edges.filter(([next]) => !parents.has(next));
  // The first node that finds a node stays its parent, so the reverse comes before the old parents.
  const nextParents = new Map([...fresh.toReversed(), ...parents]);

  return searchLevel(graph, root, [...new Set(fresh.map(([next]) => next))], nextParents);
}

/** The shortest cycle that goes through `root`, or `undefined`. */
function cycleThrough(graph: DependencyGraph, root: string): string[] | undefined {
  return searchLevel(graph, root, [root], new Map());
}

/** Gives one cycle of the dependencies as a list of IDs, with the first ID also at the end, or `undefined`. */
export function findCycle(stories: readonly DependencyStory[]): string[] | undefined {
  const graph = graphOf(stories);

  return stories.reduce<string[] | undefined>((found, story) => found ?? cycleThrough(graph, story.id), undefined);
}

function problem(kind: DependencyProblemKind, ids: readonly string[], message: string): DependencyProblem | undefined {
  return ids.length === 0 ? undefined : { kind, ids, message };
}

/** The problem of the IDs that are not Stories of the Project, or `undefined`. */
function idProblem(
  stories: readonly DependencyStory[],
  id: string,
  dependsOn: readonly string[],
): DependencyProblem | undefined {
  const key = keyOf(id);
  const known = new Set(stories.map((story) => story.id));
  const other = dependsOn.filter((dep) => keyOf(dep) !== undefined && keyOf(dep) !== key);
  const unknown = dependsOn.filter((dep) => dep !== id && !other.includes(dep) && !known.has(dep));

  return (
    problem("unknown", unknown, `Unknown Story: ${unknown.join(", ")}`) ??
    problem("otherProject", other, `Not a Story of this Project: ${other.join(", ")}`) ??
    problem("self", dependsOn.includes(id) ? [id] : [], `${id} cannot depend on itself`)
  );
}

/**
 * Gives the first problem of `dependsOn` as the new list of the Story `id`: an unknown ID, an ID of a different
 * Project, a self reference or a cycle. Gives `undefined` when the list is valid. The IDs must be in canonical form.
 */
export function dependencyError(
  stories: readonly DependencyStory[],
  id: string,
  dependsOn: readonly string[],
): DependencyProblem | undefined {
  const graph = new Map([...graphOf(stories), [id, dependsOn]]);
  const cycle = cycleThrough(graph, id) ?? [];

  return (
    idProblem(stories, id, dependsOn) ?? problem("cycle", cycle, `The dependencies make a cycle: ${cycle.join(" → ")}`)
  );
}

/** The IDs of the downstream Stories of the Story `id`, in the order of `stories`. */
export function blocksOf(stories: readonly DependencyStory[], id: string): string[] {
  return stories.filter((story) => story.dependsOn.includes(id)).map((story) => story.id);
}

/** Whether a Story in the Stage `stageKey` is complete. Only the last Stage of the board is complete. */
export function isComplete(stages: readonly DependencyStage[], stageKey: string): boolean {
  return stages.length > 0 && stages.at(-1)?.key === stageKey;
}

/**
 * The Stories of a Project by ID, built one time, so that a lookup for each Story does not build a new Map. The
 * `dependsOn` of each Story is on its entry in `byId`.
 */
export interface DependencyIndex {
  readonly byId: ReadonlyMap<string, DependencyStory>;
}

/** Builds the dependency index of `stories`. */
export function dependencyIndex(stories: readonly DependencyStory[]): DependencyIndex {
  return { byId: new Map(stories.map((story) => [story.id, story])) };
}

/** Whether the upstream Story `id` exists and is not complete. */
function isWaiting(index: DependencyIndex, stages: readonly DependencyStage[], id: string): boolean {
  const story = index.byId.get(id);

  return story !== undefined && !isComplete(stages, story.stage);
}

/** The same as `waitingFor`, with an index that the caller built one time for many Stories. */
export function indexedWaitingFor(index: DependencyIndex, stages: readonly DependencyStage[], id: string): string[] {
  const upstream = index.byId.get(id)?.dependsOn ?? [];

  return upstream.filter((dep) => isWaiting(index, stages, dep));
}

/** The same as `isBlocked`, with an index that the caller built one time for many Stories. */
export function indexedIsBlocked(index: DependencyIndex, stages: readonly DependencyStage[], id: string): boolean {
  return indexedWaitingFor(index, stages, id).length > 0;
}

/**
 * The IDs of the upstream Stories of the Story `id` that are not complete. An ID of a Story that does not exist is
 * not in the list, because `rowbly doctor` reports it.
 */
export function waitingFor(
  stories: readonly DependencyStory[],
  stages: readonly DependencyStage[],
  id: string,
): string[] {
  return indexedWaitingFor(dependencyIndex(stories), stages, id);
}

/** Whether the Story `id` has one or more upstream Stories that are not complete. */
export function isBlocked(
  stories: readonly DependencyStory[],
  stages: readonly DependencyStage[],
  id: string,
): boolean {
  return indexedIsBlocked(dependencyIndex(stories), stages, id);
}

/**
 * The IDs of the Stories that a picker can add to the `dependsOn` list of the Story `id`, in the order of `stories`:
 * not the Story itself, not an ID of the list, and not a Story that makes a cycle. A new Story has no `id` yet, so
 * each Story that is not in the list is a candidate.
 */
export function dependencyCandidates(
  stories: readonly DependencyStory[],
  id: string | undefined,
  dependsOn: readonly string[],
): string[] {
  const listed = new Set(dependsOn);
  const others = stories.filter((story) => story.id !== id && !listed.has(story.id));

  if (id === undefined) {
    return others.map((story) => story.id);
  }

  if (dependencyError(stories, id, dependsOn) !== undefined) {
    return [];
  }

  const reaching = reachingIds(stories, id);
  const key = keyOf(id);

  return others.filter((story) => isCandidate(story.id, key, reaching)).map((story) => story.id);
}

/**
 * Whether a Story that is not in the list and is not the Story itself is a valid candidate: it has no path to the
 * Story, so it does not make a cycle, and it is not a Story of a different Project.
 */
function isCandidate(candidate: string, key: string | undefined, reaching: ReadonlySet<string>): boolean {
  const candidateKey = keyOf(candidate);

  return !reaching.has(candidate) && (candidateKey === undefined || candidateKey === key);
}

// The candidates of a dependency picker must be found in linear time on a large board. A new Map, array or Set for
// each Story or each edge makes the search quadratic, so the two functions below build their own local collections in
// place. No other code sees these collections before the functions return.
// biome-ignore-start lint/plugin: the linear graph search builds its own local collections in place.

/** The reverse graph: the downstream Story IDs of each Story ID. It has no edges out of `root`. */
function dependentsOf(stories: readonly DependencyStory[], root: string): ReadonlyMap<string, readonly string[]> {
  const dependents = new Map<string, string[]>();
  const edges = stories
    .filter((story) => story.id !== root)
    .flatMap((story) => story.dependsOn.map((dep): [string, string] => [dep, story.id]));

  for (const [dep, downstream] of edges) {
    const list = dependents.get(dep);

    if (list === undefined) {
      dependents.set(dep, [downstream]);
    } else {
      list.push(downstream);
    }
  }

  return dependents;
}

/** The IDs of the Stories that have a path to `root`, with one breadth-first search on the reverse graph. */
function reachingIds(stories: readonly DependencyStory[], root: string): ReadonlySet<string> {
  const dependents = dependentsOf(stories, root);
  const found = new Set<string>([root]);
  const queue = [root];

  // The loop also visits each node that the loop adds to the end of the queue.
  for (const node of queue) {
    for (const next of dependents.get(node) ?? []) {
      if (!found.has(next)) {
        found.add(next);
        queue.push(next);
      }
    }
  }

  found.delete(root);

  return found;
}

// biome-ignore-end lint/plugin: the linear graph search ends here.
