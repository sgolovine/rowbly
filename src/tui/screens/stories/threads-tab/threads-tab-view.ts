import type { ThreadRecord } from "../../../../services/thread/thread.js";
import { conversationKeys, PANEL_FRAME_HEIGHT, PANEL_FRAME_WIDTH } from "../../../components/index.js";
import type { Layout } from "../../../hooks/index.js";
import type { KeyHint } from "../../../keymap.js";
import { THREAD_DETAIL_ROWS } from "../thread-detail/index.js";
import { threadActive, threadResumable } from "../thread-text.js";

/** The width of the thread list with its frame, and the gap after it. */
export const LIST_WIDTH = 42;
export const GAP = 1;
/** Below this width, the list and the thread take turns in one Panel. */
const SPLIT_MIN_WIDTH = LIST_WIDTH + GAP + 44;
/** Below this inner height, the thread shows its compact detail, so that the conversation keeps its room. */
const FULL_DETAIL_MIN_HEIGHT = THREAD_DETAIL_ROWS + 14;

/** Which region of the tab takes the keys. */
export type Focus = "list" | "thread";

/** What the hints of the tab depend on. */
export interface HintsInput {
  readonly keysOwn: boolean;
  readonly viewing: boolean;
  readonly current: ThreadRecord | undefined;
  readonly count: number;
}

/** The sizes and the visible regions of the tab. */
export interface ThreadsLayout {
  readonly split: boolean;
  readonly innerHeight: number | undefined;
  readonly compact: boolean;
  readonly showList: boolean;
  readonly showThread: boolean;
  readonly threadWidth: number;
  readonly conversationHeight: number | undefined;
}

/** The keys of the tab: none while another region has the keys, else the keys of the list or the thread. */
export function threadsHints({ keysOwn, viewing, current, count }: HintsInput): readonly KeyHint[] {
  const actionHints: KeyHint[] = [
    ...(current && threadActive(current) ? [{ key: "x", description: "interrupt" }] : []),
    ...(current && threadResumable(current) ? [{ key: "r", description: "resume" }] : []),
  ];

  if (!keysOwn) {
    return [];
  }

  if (viewing) {
    return [
      // The actions first: a narrow hint strip drops the later scroll keys before them.
      ...actionHints,
      ...(current ? conversationKeys(current.status === "running") : []),
      { key: "esc", description: "back to Threads" },
    ];
  }

  return [
    ...(count > 0 ? [{ key: "↑/↓", description: "select" }] : []),
    ...(current ? [{ key: "enter/tab", description: "open" }] : []),
    ...actionHints,
  ];
}

/** The rows of the thread metadata: none without a thread, the full detail, or the status and outcome rows. */
function detailRows(current: ThreadRecord | undefined, compact: boolean): number {
  const outcomeRow = current && (current.error || current.result || current.runs.at(-1)?.reason) ? 1 : 0;

  if (!current) {
    return 0;
  }

  return compact ? 1 + outcomeRow : THREAD_DETAIL_ROWS;
}

/** The sizes of the regions for `layout`, with the thread `current` and the region that has the focus. */
export function threadsLayout(layout: Layout, focus: Focus, current: ThreadRecord | undefined): ThreadsLayout {
  const split = layout.width >= SPLIT_MIN_WIDTH;
  const innerHeight = layout.height === undefined ? undefined : layout.height - PANEL_FRAME_HEIGHT;
  const compact = innerHeight !== undefined && innerHeight < FULL_DETAIL_MIN_HEIGHT;
  const threadWidth = (split ? layout.width - LIST_WIDTH - GAP : layout.width) - PANEL_FRAME_WIDTH;
  const rows = detailRows(current, compact);

  return {
    split,
    innerHeight,
    compact,
    showList: split || focus === "list",
    showThread: split || focus === "thread",
    threadWidth,
    // One blank row separates the metadata from the conversation.
    conversationHeight: innerHeight === undefined ? undefined : Math.max(2, innerHeight - rows - 1),
  };
}
