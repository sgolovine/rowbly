import type { Stage } from "../../../services/stage/stage.js";
import type { Story } from "../../../services/story/story.js";
import { rowStage, storyListRows } from "../../screens/stories/index.js";
import type { Overlay } from "../overlay.js";
import type { Board, Pane, ShellView, StoryListRow } from "./shell-state.js";

/** The data and the state that the view reads. */
export interface ShellViewInput {
  readonly data: { readonly loading: boolean; readonly data: Board | null | undefined };
  readonly active: boolean;
  readonly overlay: Overlay | null;
  readonly pane: Pane;
  readonly sidebarShown: boolean;
  readonly stageKey: string | null;
  readonly selectedId: string | null;
  readonly collapsed: ReadonlySet<string>;
}

function visibleStories(stories: readonly Story[], stage: Stage | undefined): readonly Story[] {
  return stage ? stories.filter((story) => story.stage === stage.key) : stories;
}

/** The row of the selection. Without a selection, the cursor starts on the first Story, not on a heading. */
function rowCursor(rows: readonly StoryListRow[], selectedId: string | null): number {
  const selectedAt = rows.findIndex((row) => row.id === selectedId);

  return Math.max(0, selectedAt >= 0 ? selectedAt : rows.findIndex((row) => row.kind === "story"));
}

/** `n` creates the Story in the Stage of the filter, or in the Stage of the selected row when the list shows every Stage. */
function newStoryStage(
  stages: readonly Stage[],
  stage: Stage | undefined,
  row: StoryListRow | undefined,
): string | undefined {
  return stages.find((s) => s.key === (stage?.key ?? rowStage(row)))?.key;
}

/** Derives the values of one render of the shell. */
export function shellView(input: ShellViewInput): ShellView {
  const board = input.data.data ?? undefined;
  const stages = board?.stages ?? [];
  const stories = board?.stories ?? [];
  const stage = stages.find((s) => s.key === input.stageKey);
  const rows = storyListRows(stages, visibleStories(stories, stage), stage ? undefined : input.collapsed);
  const cursor = rowCursor(rows, input.selectedId);
  const row = rows[cursor];

  const idle = input.active && input.overlay === null;
  const sidebar = board !== undefined && input.sidebarShown;
  const sidebarFocused = idle && sidebar && input.pane === "stages";

  return {
    board,
    loading: input.data.loading,
    noProject: !input.data.loading && input.data.data === null,
    stages,
    stories,
    stage,
    rows,
    cursor,
    row,
    cursorStage: newStoryStage(stages, stage, row),
    stageIndex: stage ? stages.indexOf(stage) + 1 : 0,
    idle,
    sidebar,
    sidebarFocused,
    listFocused: idle && !sidebarFocused,
  };
}
