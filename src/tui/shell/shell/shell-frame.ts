import type { BoxProps } from "ink";
import {
  FOOTER_HEIGHT,
  HEADER_HEIGHT,
  MAIN_MIN_WIDTH,
  SIDEBAR_CHROME_HEIGHT,
  SIDEBAR_MIN_WIDTH,
  STACKED_BELOW_WIDTH,
  STACKED_MIN_HEIGHT,
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
  /** The area where the Modals are centred. */
  readonly overlayBox: BoxProps;
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

/** A problem with the factory state file takes one line below the list. A missing file is no problem. */
function hasStatusLine(view: ShellView): boolean {
  return view.board !== undefined && !["ok", "missing"].includes(view.board.activity.status);
}

/** Modals are centred over the inside of the Story panel, and also the sidebar above it when stacked. */
function overlayBoxOf(height: number | undefined, left: number, width: number): BoxProps {
  return height === undefined ? {} : { position: "absolute", top: 1, left, width, height };
}

/** Sizes the regions of the shell in `layout`, with a sidebar of `sidebarWidth` columns. */
export function shellFrame(layout: Layout, view: ShellView, sidebarWidth: number): ShellFrame {
  const mainHeight = mainHeightOf(layout);
  const stacked = isStacked(view, layout, mainHeight);
  const stackedHeight = stackedHeightOf(view, stacked, mainHeight);
  const beside = view.sidebar && !stacked;
  const gap = beside ? 1 : 0;
  const room = layout.width - gap - MAIN_MIN_WIDTH;
  const shownWidth = shownWidthOf(beside, room, sidebarWidth);
  // The border and the padding of the Panel take two columns on each side.
  const mainWidth = Math.max(20, layout.width - shownWidth - gap - 4);
  const listHeight = less(mainHeight, stackedHeight);
  const statusLine = hasStatusLine(view);
  const overlayHeight = less(mainHeight, 2);

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
    overlayBox: overlayBoxOf(overlayHeight, shownWidth + gap + 2, mainWidth),
  };
}
