import type { Stage } from "../../../services/stage/stage.js";
import type { Story } from "../../../services/story/story.js";
import { blocksOf, dependencyCandidates } from "../../../services/story-dependency/story-dependency.js";
import type { StageCategory } from "../../components/index.js";
import { stageCategory } from "./stage-category.js";

/** The choices of the `Depends on` field: the IDs, and the `<ID> <title>` label of each ID. */
export interface DependencyChoices {
  readonly options: readonly string[];
  readonly labels: Readonly<Record<string, string>>;
  readonly searchText: Readonly<Record<string, readonly string[]>>;
}

/** One Story of the `Depends on` or `Blocks` list of the General tab. */
export interface DependencyItem {
  readonly id: string;
  /** The title, or an empty text when the Project has no Story with the ID. */
  readonly title: string;
  readonly stage: { readonly name: string; readonly category: StageCategory } | undefined;
}

/** The upstream and the downstream Stories of one Story. */
export interface DependencyLists {
  readonly dependsOn: readonly DependencyItem[];
  readonly blocks: readonly DependencyItem[];
}

/** The changes of an update of the `dependsOn` list, or no keys when the list does not change. */
interface DependsOnChanges {
  readonly addDependsOn?: string[];
  readonly removeDependsOn?: string[];
}

/** The most IDs that the `waiting for` text of a Story row shows. */
const WAITING_MAX = 3;

/**
 * The choices of the `Depends on` field of the Story `id`: the IDs of the list, then the Stories that the picker
 * can add. A new Story has no `id`.
 */
export function dependencyChoices(
  stories: readonly Story[],
  id: string | undefined,
  dependsOn: readonly string[],
): DependencyChoices {
  // Each Story gets a label, so that an ID keeps its title after the board reads a change of the Stories.
  return {
    options: [...dependsOn, ...dependencyCandidates(stories, id, dependsOn)],
    labels: Object.fromEntries(stories.map((story) => [story.id, `${story.id} ${story.title}`])),
    searchText: Object.fromEntries(stories.map((story) => [story.id, [story.id, story.title]])),
  };
}

function dependencyItem(stories: readonly Story[], stages: readonly Stage[], id: string): DependencyItem {
  const story = stories.find((s) => s.id === id);

  if (!story) {
    return { id, title: "", stage: undefined };
  }

  return {
    id,
    title: story.title,
    stage: {
      name: stages.find((s) => s.key === story.stage)?.label ?? story.stage,
      category: stageCategory(stages, story.stage),
    },
  };
}

/** The `Depends on` and the `Blocks` lists of the Story `id`, with the title and the Stage of each Story. */
export function dependencyLists(
  stories: readonly Story[],
  stages: readonly Stage[],
  id: string,
  dependsOn: readonly string[],
): DependencyLists {
  return {
    dependsOn: dependsOn.map((dep) => dependencyItem(stories, stages, dep)),
    blocks: blocksOf(stories, id).map((dep) => dependencyItem(stories, stages, dep)),
  };
}

/** The additions and the removals that change the list `before` to the list `after`. */
export function dependsOnChanges(before: readonly string[], after: readonly string[]): DependsOnChanges {
  const added = after.filter((id) => !before.includes(id));
  const removed = before.filter((id) => !after.includes(id));

  return {
    ...(added.length > 0 ? { addDependsOn: added } : {}),
    ...(removed.length > 0 ? { removeDependsOn: removed } : {}),
  };
}

/** The IDs of a form value of the `Depends on` field. */
export function dependsOnValue(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((id): id is string => typeof id === "string") : [];
}

/** `waiting for ROW-01, ROW-02`, with the first `WAITING_MAX` IDs and the count of the other IDs. */
export function waitingText(ids: readonly string[]): string {
  const rest = ids.length - WAITING_MAX;

  return `waiting for ${ids.slice(0, WAITING_MAX).join(", ")}${rest > 0 ? ` +${rest}` : ""}`;
}
