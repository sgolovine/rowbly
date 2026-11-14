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
  readonly stackedHeight: number;
  /** The column between the sidebar and the list. */
  readonly gap: number;
  /** The most columns the sidebar can take. */
  readonly room: number;
  /** The columns of the sidebar beside the list, or `0`. */
  readonly shownWidth: number;
  /** The columns inside the Story panel. */
  readonly mainWidth: number;
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

/** The stacked sidebar fits its entries, and it leaves at least half of the main area to the list. */
function stackedHeightOf(view: ShellView, stacked: boolean, mainHeight: number | undefined): number {
  return stacked && mainHeight !== undefined
    ? Math.min(view.stages.length + 1 + SIDEBAR_CHROME_HEIGHT, Math.floor(mainHeight / 2))
    : 0;
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

  return { mode: "full", shown, cover: shown, width: layout.width, room: layout.width, height: mainHeight };
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
    gap: 0,
    room: 0,
    shownWidth: 0,
    mainWidth,
    listHeight: mainHeight,
    listInnerHeight: less(mainHeight, 2),
    statusLine: hasStatusLine(view),
    overlayHeight,
    overlayWidth: mainWidth,
    overlayBox: overlayBoxOf(overlayHeight, 2, mainWidth),
    story,
  };
}

/**
 * Sizes the regions of the shell in `layout`, with a sidebar of `sidebarWidth` columns and a Story sidebar of
 * `storyWidth` columns (`null` for the default width).
 */
export function shellFrame(
  layout: Layout,
  view: ShellView,
  sidebarWidth: number,
  storyWidth: number | null = null,
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
  // Beside the list, the Story sidebar keeps its narrowest width and the column before it.
  const storyReserve = storyMode === "beside" ? STORY_SIDEBAR_MIN_WIDTH + 1 : 0;
  const room = layout.width - gap - MAIN_MIN_WIDTH - storyReserve;
  const shownWidth = shownWidthOf(beside, room, sidebarWidth);
  const storyRoom = layout.width - shownWidth - gap - MAIN_MIN_WIDTH - 1;
  const storyColumns = storyMode === "beside" ? storyWidthOf(layout, storyRoom, storyWidth) : 0;
  const storyBeside = storyColumns > 0 ? storyColumns + 1 : 0;
  // The border and the padding of the Panel take two columns on each side.
  const mainWidth = Math.max(20, layout.width - shownWidth - gap - storyBeside - 4);
  const listHeight = less(mainHeight, stackedHeight);
  const statusLine = hasStatusLine(view);
  const overlayHeight = less(mainHeight, 2);
  // A Modal over a Story list that the Story sidebar makes narrow also takes the room of the Story sidebar.
  const overlayWidth = mainWidth + storyBeside;
  const story: StoryFrame =
    storyMode === "beside"
      ? { mode: storyMode, shown: true, cover: false, width: storyColumns, room: storyRoom, height: mainHeight }
      : { mode: storyMode, shown: false, cover: false, width: layout.width, room: layout.width, height: mainHeight };

  return {
    width: layout.width,
    mainHeight,
    stacked,
    stackedHeight,
    gap,
    room,
    shownWidth,
    mainWidth,
    listHeight,
    listInnerHeight: less(listHeight, 2 + (statusLine ? 1 : 0)),
    statusLine,
    overlayHeight,
    overlayWidth,
    overlayBox: overlayBoxOf(overlayHeight, shownWidth + gap + 2, overlayWidth),
    story,
  };
}
