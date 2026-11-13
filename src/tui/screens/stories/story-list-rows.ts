import type { Stage } from "../../../services/stage/stage.js";
import type { Story } from "../../../services/story/story.js";
import type { StageCategory } from "../../components/index.js";
import { stageCategory } from "./stage-category.js";

/** A row of the Story list: the heading of a Stage section, or a Story with its Stage. */
export type StoryListRow =
  | {
      readonly kind: "stage";
      readonly id: string;
      readonly key: string;
      readonly label: string;
      readonly count: number;
      readonly collapsed: boolean;
    }
  | {
      readonly kind: "story";
      readonly id: string;
      readonly story: Story;
      readonly stage: { readonly name: string; readonly category: StageCategory };
    };

/** A Stage section of the list: its key and its heading. */
interface Section {
  readonly key: string;
  readonly label: string;
}

/** The row id of the heading of the Stage `key`. A Story id cannot contain `:`. */
export function stageRowId(key: string): string {
  return `stage:${key}`;
}

/** The row of `story`, with the name and the category of its Stage. */
function storyRow(stages: readonly Stage[], story: Story): StoryListRow {
  return {
    kind: "story",
    id: story.id,
    story,
    stage: {
      name: stages.find((s) => s.key === story.stage)?.label ?? story.stage,
      category: stageCategory(stages, story.stage),
    },
  };
}

/** The sections in board order, then a section for each Stage of a Story that is not in `stages`. */
function sectionsOf(stages: readonly Stage[], stories: readonly Story[]): Section[] {
  const unknown = [...new Set(stories.map((story) => story.stage))].filter((key) => !stages.some((s) => s.key === key));

  return [...stages.map((s) => ({ key: s.key, label: s.label })), ...unknown.map((key) => ({ key, label: key }))];
}

/** The heading of `section`, then its Stories if the section is not collapsed. */
function sectionRows(
  stages: readonly Stage[],
  stories: readonly Story[],
  collapsed: ReadonlySet<string>,
  { key, label }: Section,
): StoryListRow[] {
  const inStage = stories.filter((story) => story.stage === key);
  const folded = collapsed.has(key);
  const heading: StoryListRow = {
    kind: "stage",
    id: stageRowId(key),
    key,
    label,
    count: inStage.length,
    collapsed: folded,
  };

  return [heading, ...(folded ? [] : inStage.map((story) => storyRow(stages, story)))];
}

/**
 * The rows of the Story list. Without `collapsed`, the rows are only the Stories. With `collapsed`, each
 * Stage gets a heading in board order, then its Stories if its key is not in `collapsed`. Stories in a
 * Stage that is not in `stages` (for example, after a hand edit) get a section of their own at the end.
 */
export function storyListRows(
  stages: readonly Stage[],
  stories: readonly Story[],
  collapsed?: ReadonlySet<string>,
): StoryListRow[] {
  if (!collapsed) {
    return stories.map((story) => storyRow(stages, story));
  }

  return sectionsOf(stages, stories).flatMap((section) => sectionRows(stages, stories, collapsed, section));
}

/** The Stage key of a row: the Stage of its section heading, or the Stage of its Story. */
export function rowStage(row: StoryListRow | undefined): string | undefined {
  if (!row) {
    return undefined;
  }

  return row.kind === "stage" ? row.key : row.story.stage;
}
