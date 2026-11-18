// The manager rule that finds an upstream Story that cannot progress. This module does no I/O.
import { type DependencyStory, isComplete, waitingFor } from "../story-dependency/story-dependency.js";
import { type ClassifiedStage, workStageKeys } from "./dependency-facts.js";
import type { Attention } from "./manager-state.js";

/** The start of the attention key of a stuck upstream Story. */
export const UPSTREAM_STUCK = "upstream-stuck:";

const MAX_TEXT = 500;

/** The reason why the upstream Story cannot progress, or `undefined` when it can progress. */
function stuckReason(
  story: DependencyStory,
  stages: readonly ClassifiedStage[],
  parked: Readonly<Record<string, unknown>>,
): string | undefined {
  const stage = stages.find((candidate) => candidate.key === story.stage);

  if (stages[0]?.key === story.stage) {
    return `in ${stages[0].label}`;
  }

  if (parked[story.id] !== undefined) {
    return "parked";
  }

  if (stage?.promptClass === "hold" && !isComplete(stages, story.stage)) {
    return `in hold Stage ${stage.label}`;
  }

  return undefined;
}

function attentionText(upstream: string, reason: string, downstream: readonly string[]): string {
  const verb = downstream.length === 1 ? "waits" : "wait";

  return `${upstream} cannot progress (${reason}). ${downstream.join(", ")} ${verb} for it.`.slice(0, MAX_TEXT);
}

/** One blocked downstream Story in a `work` Stage and one of its upstream Stories that is not complete. */
interface WaitEdge {
  readonly upstream: string;
  readonly downstream: string;
}

/** The facts that the rule reads for each upstream Story. */
interface UpstreamFacts {
  readonly byId: ReadonlyMap<string, DependencyStory>;
  readonly stages: readonly ClassifiedStage[];
  readonly parked: Readonly<Record<string, unknown>>;
  readonly edges: readonly WaitEdge[];
}

/** The attention entry of the upstream Story `id`, or no entry when the Story can progress. */
function upstreamEntry(facts: UpstreamFacts, id: string): [string, Attention][] {
  const story = facts.byId.get(id);
  const reason = story && stuckReason(story, facts.stages, facts.parked);
  const downstream = facts.edges.filter((edge) => edge.upstream === id).map((edge) => edge.downstream);

  return reason ? [[`${UPSTREAM_STUCK}${id}`, { text: attentionText(id, reason, downstream), storyId: id }]] : [];
}

function waitEdges(stories: readonly DependencyStory[], stages: readonly ClassifiedStage[]): WaitEdge[] {
  const work = workStageKeys(stages);

  return stories
    .filter((story) => work.has(story.stage))
    .flatMap((story) => waitingFor(stories, stages, story.id).map((upstream) => ({ upstream, downstream: story.id })));
}

/**
 * Gives one attention entry for each upstream Story that cannot progress, by the key `upstream-stuck:<id>`.
 * Only a blocked downstream Story in a `work` Stage counts, because only that Story waits for a worker.
 */
export function upstreamAttention(
  stories: readonly DependencyStory[],
  stages: readonly ClassifiedStage[],
  parked: Readonly<Record<string, unknown>>,
): ReadonlyMap<string, Attention> {
  const edges = waitEdges(stories, stages);
  const facts: UpstreamFacts = { byId: new Map(stories.map((story) => [story.id, story])), stages, parked, edges };
  const upstreamIds = [...new Set(edges.map((edge) => edge.upstream))];

  return new Map(upstreamIds.flatMap((id) => upstreamEntry(facts, id)));
}

/** Replaces the `upstream-stuck:` entries of `attention` with `entries`. The other entries do not change. */
export function withUpstreamAttention(
  attention: ReadonlyMap<string, Attention>,
  entries: ReadonlyMap<string, Attention>,
): ReadonlyMap<string, Attention> {
  const kept = [...attention].filter(([key]) => !key.startsWith(UPSTREAM_STUCK) || entries.has(key));

  return new Map([...kept, ...entries]);
}
