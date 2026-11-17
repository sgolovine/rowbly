import { projectTags, type TagConfig } from "../../../services/config/config.js";
import type { Stage } from "../../../services/stage/stage.js";
import type { Story } from "../../../services/story/story.js";
import { rowStage, storyListRows } from "../../screens/stories/index.js";
import type { Overlay, SidePane } from "../overlay.js";
import type { Board, Pane, ShellView, StoryListRow, ViewMode } from "./shell-state.js";

/** The data and the state that the view reads. */
export interface ShellViewInput {
  readonly data: { readonly loading: boolean; readonly data: Board | null | undefined };
  readonly active: boolean;
  readonly overlay: Overlay | null;
  readonly pane: Pane;
  readonly storyPane: SidePane | null;
  readonly mode: ViewMode;
  readonly sidebarShown: boolean;
  readonly stageKey: string | null;
  readonly tagKey: string | null;
  readonly selectedId: string | null;
  readonly collapsed: ReadonlySet<string>;
  readonly marked: ReadonlySet<string>;
  readonly anchor: string | null;
  /** The rows of the Story list, from `shellRows`. */
  readonly rows: readonly StoryListRow[];
}

function stageStories(stories: readonly Story[], stage: Stage | undefined): readonly Story[] {
  return stage ? stories.filter((story) => story.stage === stage.key) : stories;
}

function tagStories(stories: readonly Story[], tag: TagConfig | undefined): readonly Story[] {
  return tag ? stories.filter((story) => story.tags.includes(tag.value)) : stories;
}

/** The tags of the Project of `board`, in config order. */
function boardTags(board: Board | null | undefined): readonly TagConfig[] {
  return board ? projectTags(board.project) : [];
}

/**
 * The rows of the Story list of `board`. With a Stage filter, the list shows only the Stories of that Stage, without
 * headings. With a tag filter, the list shows only the Stories with that tag. A tag that is not in the config does not
 * filter. The caller memoizes the result, so that a key that only moves the cursor does not build the rows again.
 */
export function shellRows(
  board: Board | null | undefined,
  stageKey: string | null,
  tagKey: string | null,
  collapsed: ReadonlySet<string>,
): readonly StoryListRow[] {
  const stages = board?.stages ?? [];
  const stories = board?.stories ?? [];
  const stage = stages.find((s) => s.key === stageKey);
  const tag = boardTags(board).find((t) => t.value === tagKey);
  const visible = tagStories(stageStories(stories, stage), tag);

  // All Stories go to the dependency index, also the Stories that a filter hides.
  return storyListRows(stages, visible, stage ? undefined : collapsed, stories);
}

/** The row of the selection. Without a selection, the cursor starts on the first Story, not on a heading. */
function rowCursor(rows: readonly StoryListRow[], selectedId: string | null): number {
  const selectedAt = rows.findIndex((row) => row.id === selectedId);

  return Math.max(0, selectedAt >= 0 ? selectedAt : rows.findIndex((row) => row.kind === "story"));
}

/** The IDs of the Story rows from the row at `from` to the row at `to`. The order of `from` and `to` does not matter. */
export function storyIdsBetween(rows: readonly StoryListRow[], from: number, to: number): readonly string[] {
  return rows
    .slice(Math.min(from, to), Math.max(from, to) + 1)
    .flatMap((row) => (row.kind === "story" ? [row.id] : []));
}

/**
 * The Stories that show a mark. In the range mode, they are the Story rows from the anchor to the cursor. Otherwise,
 * they are the selected Stories that exist, so a Story that a reload removed goes out of the selection.
 */
function shownMarks(
  rows: readonly StoryListRow[],
  stories: readonly Story[],
  input: ShellViewInput,
  cursor: number,
): ReadonlySet<string> {
  if (input.anchor !== null) {
    const at = rows.findIndex((row) => row.id === input.anchor);

    return new Set(at >= 0 ? storyIdsBetween(rows, at, cursor) : []);
  }

  return new Set(stories.filter((story) => input.marked.has(story.id)).map((story) => story.id));
}

/** `n` creates the Story in the Stage of the filter, or in the Stage of the selected row when the list shows every Stage. */
function newStoryStage(
  stages: readonly Stage[],
  stage: Stage | undefined,
  row: StoryListRow | undefined,
): string | undefined {
  return stages.find((s) => s.key === (stage?.key ?? rowStage(row)))?.key;
}

/** The values of the tag filter and of the tag sidebar. */
function tagView(
  board: Board | undefined,
  input: ShellViewInput,
  sidebar: boolean,
  idle: boolean,
): Pick<ShellView, "tags" | "tag" | "tagIndex" | "tagSidebar" | "tagSidebarFocused"> {
  const tags = boardTags(board);
  const tag = tags.find((t) => t.value === input.tagKey);
  const tagSidebar = sidebar && tags.length > 0;

  // When the last tag goes, the tag sidebar does not show, and the Story list has the focus.
  return {
    tags,
    tag,
    tagIndex: tag ? tags.indexOf(tag) + 1 : 0,
    tagSidebar,
    tagSidebarFocused: idle && tagSidebar && input.pane === "tags",
  };
}

/** Derives the values of one render of the shell. */
export function shellView(input: ShellViewInput): ShellView {
  const board = input.data.data ?? undefined;
  const stages = board?.stages ?? [];
  const stories = board?.stories ?? [];
  const stage = stages.find((s) => s.key === input.stageKey);
  const { rows } = input;
  const cursor = rowCursor(rows, input.selectedId);
  const row = rows[cursor];

  const idle = input.active && input.overlay === null;
  const sidebar = board !== undefined && input.sidebarShown;
  const sidebarFocused = idle && sidebar && input.pane === "stages";
  const tagged = tagView(board, input, sidebar, idle);
  const storyPane = board ? input.storyPane : null;
  const storyActive = storyPane !== null && input.pane === "story";
  const storyFocused = idle && storyActive;

  return {
    board,
    loading: input.data.loading,
    noProject: !input.data.loading && input.data.data === null,
    stages,
    stories,
    mode: input.mode,
    stage,
    rows,
    cursor,
    row,
    cursorStage: newStoryStage(stages, stage, row),
    stageIndex: stage ? stages.indexOf(stage) + 1 : 0,
    ...tagged,
    marked: shownMarks(rows, stories, input, cursor),
    ranging: input.anchor !== null,
    storyPane,
    storyActive,
    idle,
    shellKeys: idle && !storyFocused,
    sidebar,
    sidebarFocused,
    listFocused: idle && !sidebarFocused && !tagged.tagSidebarFocused && !storyFocused,
    storyFocused,
  };
}
