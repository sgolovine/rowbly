import type { Stage } from "../../../services/stage/stage.js";
import type { Story } from "../../../services/story/story.js";
import type { StageCategory } from "../../components/index.js";
import { stageCategory } from "./stage-category.js";

/** A row of the Story list: the heading of a Stage section, or a Story with its Stage. */
export type StoryListRow =
  | { kind: "stage"; id: string; key: string; label: string; count: number; collapsed: boolean }
  | { kind: "story"; id: string; story: Story; stage: { name: string; category: StageCategory } };

/** The row id of the heading of the Stage `key`. A Story id cannot contain `:`. */
export function stageRowId(key: string): string {
  return `stage:${key}`;
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
  const storyRow = (story: Story): StoryListRow => ({
    kind: "story",
    id: story.id,
    story,
    stage: {
      name: stages.find((s) => s.key === story.stage)?.label ?? story.stage,
      category: stageCategory(stages, story.stage),
    },
  });
  if (!collapsed) return stories.map(storyRow);
  const unknown = [...new Set(stories.map((story) => story.stage))].filter((key) => !stages.some((s) => s.key === key));
  const sections = [
    ...stages.map((s) => ({ key: s.key, label: s.label })),
    ...unknown.map((key) => ({ key, label: key })),
  ];
  return sections.flatMap(({ key, label }) => {
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
    return [heading, ...(folded ? [] : inStage.map(storyRow))];
  });
}

/** The Stage key of a row: the Stage of its section heading, or the Stage of its Story. */
export function rowStage(row: StoryListRow | undefined): string | undefined {
  if (!row) return undefined;
  return row.kind === "stage" ? row.key : row.story.stage;
}
