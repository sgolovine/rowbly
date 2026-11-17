import type { BoxProps } from "ink";
import {
  FOOTER_HEIGHT,
  HEADER_HEIGHT,
  MAIN_MIN_WIDTH,
  SIDEBAR_CHROME_HEIGHT,
  SIDEBAR_MIN_WIDTH,
  STACKED_BELOW_WIDTH,
  STACKED_MIN_HEIGHT,
  STORY_SIDEBAR_MIN_WIDTH,
  STORY_SIDEBAR_WIDTH,
} from "../../components/index.js";
import type { Layout } from "../../hooks/index.js";
import type { ShellView } from "./shell-state.js";

/** The sizes of the regions of the shell. A height is `undefined` when the app grows with its content. */
export interface ShellFrame {
  readonly width: number;
  /** The rows between the header and the footer. */
  readonly mainHeight: number | undefined;
  /** The sidebar goes above the list in a narrow terminal. */
  readonly stacked: boolean;
  /** The rows of the sidebars above the list when stacked, or `0`. */
  readonly stackedHeight: number;
  /** The rows of the Stage sidebar, or `undefined` when it grows with its content. */
  readonly stagesHeight: number | undefined;
  /** The rows of the tag sidebar below the Stage sidebar, or `0` when it does not show. */
  readonly tagsHeight: number | undefined;
  /** The column between the sidebar and the list. */
  readonly gap: number;
  /** The most columns the sidebar can take. */
  readonly room: number;
  /** The columns of the sidebar beside the list, or `0`. */
  readonly shownWidth: number;
  /** The columns inside the Story panel. */
  readonly mainWidth: number;
  /** The Story list is on the screen. An expanded Story sidebar takes its columns. */
  readonly listShown: boolean;
  readonly listHeight: number | undefined;
  /** The rows inside the Story panel, without the factory status line. */
  readonly listInnerHeight: number | undefined;
  readonly statusLine: boolean;
  readonly overlayHeight: number | undefined;
  /** The columns where the Modals are centred: the Story list, and also the Story sidebar beside it. */
  readonly overlayWidth: number;
  /** The area where the Modals are centred. */
  readonly overlayBox: BoxProps;
  /** The Story sidebar. */
  readonly story: StoryFrame;
}

/** The size and the place of the Story sidebar. */
interface StoryFrame {
  /** How the Story sidebar shows: closed, beside the Story list, or on the full main area. */
  readonly mode: "closed" | "beside" | "full";
  /** The Story sidebar is on the screen. A full Story sidebar shows only while it is the selected pane. */
  readonly shown: boolean;
  /** The Story sidebar covers the main area, so the Stage sidebar and the Story list do not show. */
  readonly cover: boolean;
  /** The Story sidebar beside the list is expanded: it takes the columns of the Story list, which does not show. */
  readonly expanded: boolean;
  /** The columns of the Story sidebar, with its border. */
  readonly width: number;
  /** The most columns that a drag can give the Story sidebar. */
  readonly room: number;
  /** The rows of the Story sidebar, with its border. */
  readonly height: number | undefined;
}

function less(height: number | undefined, rows: number): number | undefined {
  return height === undefined ? undefined : height - rows;
}

function mainHeightOf(layout: Layout): number | undefined {
  return layout.height === undefined ? undefined : Math.max(7, layout.height - HEADER_HEIGHT - FOOTER_HEIGHT);
}

/** A terminal that is both narrow and short keeps the sidebar beside the list, where each has its full height. */
function isStacked(view: ShellView, layout: Layout, mainHeight: number | undefined): boolean {
  return (
    view.sidebar && layout.width < STACKED_BELOW_WIDTH && (mainHeight === undefined || mainHeight >= STACKED_MIN_HEIGHT)
  );
}

/** The rows that show all entries of a sidebar: the entries, the first entry (All …) and the chrome. */
function entriesHeight(count: number): number {
  return count + 1 + SIDEBAR_CHROME_HEIGHT;
}

/** The rows that show all entries of the tag sidebar, or `0` when it does not show. */
function tagsNeed(view: ShellView): number {
  return view.tagSidebar ? entriesHeight(view.tags.length) : 0;
}

/**
 * The stacked sidebars fit their entries, and they leave at least half of the main area to the list. The tag sidebar
 * goes below the Stage sidebar in the same rows.
 */
function stackedHeightOf(view: ShellView, stacked: boolean, mainHeight: number | undefined): number {
  return stacked && mainHeight !== undefined
    ? Math.min(entriesHeight(view.stages.length) + tagsNeed(view), Math.floor(mainHeight / 2))
    : 0;
}

/** The rows of the tag sidebar in `height` rows: all its entries, but not more than its half of the rows. */
function tagsHeightOf(need: number, height: number, stagesNeed: number): number {
  return Math.min(need, Math.max(Math.floor(height / 2), height - stagesNeed));
}

/** The rows of the Stage sidebar and of the tag sidebar: beside the list, or stacked above it. */
function sidebarHeightsOf(
  view: ShellView,
  stacked: boolean,
  stackedHeight: number,
  mainHeight: number | undefined,
): Pick<ShellFrame, "stagesHeight" | "tagsHeight"> {
  const height = stacked ? stackedHeight || undefined : mainHeight;
  const need = tagsNeed(view);

  if (height === undefined || need === 0) {
    return { stagesHeight: height, tagsHeight: need === 0 ? 0 : undefined };
  }

  // Beside the list, the Stage sidebar keeps at least half of the rows.
  const tagsHeight = stacked
    ? tagsHeightOf(need, height, entriesHeight(view.stages.length))
    : Math.min(need, Math.floor(height / 2));

  return { stagesHeight: height - tagsHeight, tagsHeight };
}

/** The sidebar can grow until the Story list is narrower than `MAIN_MIN_WIDTH`. */
function shownWidthOf(beside: boolean, room: number, sidebarWidth: number): number {
  return beside ? Math.max(SIDEBAR_MIN_WIDTH, Math.min(room, sidebarWidth)) : 0;
}

/**
 * A problem with the factory state file takes one line below the Story list. A missing file is no problem. The
 * Factory view has no such line.
 */
function hasStatusLine(view: ShellView): boolean {
  return view.mode !== "threads" && view.board !== undefined && !["ok", "missing"].includes(view.board.activity.status);
}

/** Modals are centred over the inside of the Story panel, and also the sidebar above it when stacked. */
function overlayBoxOf(height: number | undefined, left: number, width: number): BoxProps {
  return height === undefined ? {} : { position: "absolute", top: 1, left, width, height };
}

/**
 * The Story sidebar goes beside the Story list when the terminal is not narrow, and when the narrowest Stage
 * sidebar, the narrowest Story list and the narrowest Story sidebar fit. Else it takes the full main area.
 */
function storyModeOf(view: ShellView, layout: Layout): StoryFrame["mode"] {
  if (!view.storyPane) {
    return "closed";
  }

  const stages = view.sidebar ? SIDEBAR_MIN_WIDTH + 1 : 0;
  const fits = layout.width - stages - MAIN_MIN_WIDTH - 1 >= STORY_SIDEBAR_MIN_WIDTH;

  return layout.width >= STACKED_BELOW_WIDTH && fits ? "beside" : "full";
}

/** The width of the Story sidebar beside the list: the dragged width, or a part of the terminal width. */
function storyWidthOf(layout: Layout, room: number, storyWidth: number | null): number {
  const wanted = storyWidth ?? Math.floor(layout.width * STORY_SIDEBAR_WIDTH);

  return Math.max(STORY_SIDEBAR_MIN_WIDTH, Math.min(room, wanted));
}

/** The Story sidebar on the full main area: it covers the other panes while it is the selected pane. */
function fullStory(view: ShellView, layout: Layout, mainHeight: number | undefined): StoryFrame {
  const shown = view.storyActive;

  return {
    mode: "full",
    shown,
    cover: shown,
    expanded: false,
    width: layout.width,
    room: layout.width,
    height: mainHeight,
  };
}

/** Sizes the regions of the shell when the Story sidebar covers the main area. */
function coverFrame(layout: Layout, view: ShellView, story: StoryFrame): ShellFrame {
  const mainHeight = story.height;
  const overlayHeight = less(mainHeight, 2);
  const mainWidth = Math.max(20, layout.width - 4);

  return {
    width: layout.width,
    mainHeight,
    stacked: false,
    stackedHeight: 0,
    stagesHeight: undefined,
    tagsHeight: 0,
    gap: 0,
    room: 0,
    shownWidth: 0,
    mainWidth,
    listShown: false,
    listHeight: mainHeight,
    listInnerHeight: less(mainHeight, 2),
    statusLine: hasStatusLine(view),
    overlayHeight,
    overlayWidth: mainWidth,
    overlayBox: overlayBoxOf(overlayHeight, 2, mainWidth),
    story,
  };
}

/** The values that give the width of the Story sidebar beside the list. */
interface StoryColumns {
  readonly layout: Layout;
  /** The columns at the right of the Stage sidebar. */
  readonly free: number;
  /** The most columns that a drag can give the Story sidebar. */
  readonly room: number;
  readonly storyWidth: number | null;
}

/** The columns of the Story sidebar: none while it is not beside the list, all the columns of the list when expanded. */
function storyColumnsOf(storyMode: StoryFrame["mode"], expanded: boolean, columns: StoryColumns): number {
  if (storyMode !== "beside") {
    return 0;
  }

  return expanded ? columns.free : storyWidthOf(columns.layout, columns.room, columns.storyWidth);
}

/** The Story sidebar when it does not cover the main area. */
function sideStory(
  storyMode: StoryFrame["mode"],
  expanded: boolean,
  frame: Omit<StoryFrame, "mode" | "shown" | "cover" | "expanded">,
): StoryFrame {
  return storyMode === "beside"
    ? { mode: storyMode, shown: true, cover: false, expanded, ...frame }
    : { mode: storyMode, shown: false, cover: false, expanded: false, ...frame };
}

/**
 * Sizes the regions of the shell in `layout`, with a sidebar of `sidebarWidth` columns and a Story sidebar of
 * `storyWidth` columns (`null` for the default width). An `expanded` Story sidebar beside the list takes the columns
 * of the Story list. It has no effect when the Story sidebar covers the main area.
 */
export function shellFrame(
  layout: Layout,
  view: ShellView,
  sidebarWidth: number,
  storyWidth: number | null = null,
  expanded = false,
): ShellFrame {
  const mainHeight = mainHeightOf(layout);
  const storyMode = storyModeOf(view, layout);

  if (storyMode === "full" && view.storyActive) {
    return coverFrame(layout, view, fullStory(view, layout, mainHeight));
  }

  const stacked = isStacked(view, layout, mainHeight);
  const stackedHeight = stackedHeightOf(view, stacked, mainHeight);
  const beside = view.sidebar && !stacked;
  const gap = beside ? 1 : 0;
  const isExpanded = expanded && storyMode === "beside";
  // Beside the list, the Story sidebar keeps its narrowest width and the column before it.
  const storyReserve = storyMode === "beside" ? STORY_SIDEBAR_MIN_WIDTH + 1 : 0;
  const room = layout.width - gap - MAIN_MIN_WIDTH - storyReserve;
  const shownWidth = shownWidthOf(beside, room, sidebarWidth);
  const free = layout.width - shownWidth - gap;
  const storyRoom = free - MAIN_MIN_WIDTH - 1;
  const storyColumns = storyColumnsOf(storyMode, isExpanded, { layout, free, room: storyRoom, storyWidth });
  const storyBeside = storyColumns > 0 && !isExpanded ? storyColumns + 1 : 0;
  // The border and the padding of the Panel take two columns on each side.
  const mainWidth = Math.max(20, (isExpanded ? free : free - storyBeside) - 4);
  const listHeight = less(mainHeight, stackedHeight);
  const statusLine = hasStatusLine(view);
  const overlayHeight = less(mainHeight, 2);
  // A Modal over a Story list that the Story sidebar makes narrow also takes the room of the Story sidebar.
  const overlayWidth = isExpanded ? mainWidth : mainWidth + storyBeside;
  const story = sideStory(storyMode, isExpanded, {
    width: storyMode === "beside" ? storyColumns : layout.width,
    room: storyMode === "beside" ? storyRoom : layout.width,
    height: mainHeight,
  });

  return {
    width: layout.width,
    mainHeight,
    stacked,
    stackedHeight,
    ...sidebarHeightsOf(view, stacked, stackedHeight, mainHeight),
    gap,
    room,
    shownWidth,
    mainWidth,
    listShown: !isExpanded,
    listHeight,
    listInnerHeight: less(listHeight, 2 + (statusLine ? 1 : 0)),
    statusLine,
    overlayHeight,
    overlayWidth,
    overlayBox: overlayBoxOf(overlayHeight, shownWidth + gap + 2, overlayWidth),
    story,
  };
}
