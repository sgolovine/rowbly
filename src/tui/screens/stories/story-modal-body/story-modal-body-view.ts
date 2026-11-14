import { IMAGE_PASTE_HINT, type Layout } from "../../../hooks/index.js";
import type { KeyHint } from "../../../keymap.js";
import type { StoryConfirm } from "../story-confirm-dialogs/index.js";
import { STORY_PADDING_X, type StoryTabId } from "../story-tab-panes/index.js";

/** Which confirmation is on top of the Story form. */
export type StoryModalConfirm = StoryConfirm;

/** The blank row above the Tabs and the row of the Tabs. */
const TABS_HEIGHT = 2;
/** The blank row under the Tabs and the blank row at the bottom of the General tab. */
const GENERAL_PADDING_Y = 2;
const GENERAL_HINTS: readonly KeyHint[] = [{ key: "ctrl+d", description: "delete" }];
const CLOSE_HINT: KeyHint = { key: "esc", description: "Story list" };

/** The key hints that the tabs reported, and whether a region of a tab takes `esc` and `tab`. */
export interface TabHints {
  readonly specHints: readonly KeyHint[];
  readonly threadHints: readonly KeyHint[];
  readonly attachmentHints: readonly KeyHint[];
  readonly tabOwnsKeys: boolean;
}

/** The ids of the tabs, with Specs only when the Project has Specs on. */
export function storyTabIds(specs: boolean): readonly StoryTabId[] {
  return specs ? ["general", "specs", "attachments", "threads"] : ["general", "attachments", "threads"];
}

/** The id of the tab after `index`, and the first tab after the last tab. */
export function nextTabId(ids: readonly StoryTabId[], index: number): StoryTabId {
  return ids[(index + 1) % ids.length] ?? "general";
}

/** A tab label with its count, when the count is known. */
function countLabel(label: string, count: number | undefined): string {
  return count === undefined ? label : `${label} ${count}`;
}

/** The labels of the tabs, in the order of `storyTabIds`. */
export function storyTabLabels(
  specs: boolean,
  specCount: number | undefined,
  threadCount: number | undefined,
): string[] {
  return [
    "General",
    ...(specs ? [countLabel("Specs", specCount)] : []),
    "Attachments",
    countLabel("Threads", threadCount),
  ];
}

/** The hints of the tab on the screen. The General tab has its own hints in the Form. */
function shownTabHints(shown: StoryTabId, tabs: TabHints): readonly KeyHint[] {
  if (shown === "attachments") {
    return tabs.attachmentHints;
  }

  return shown === "threads" ? tabs.threadHints : tabs.specHints;
}

/** The keys of the Modal: the keys of the tab, then the keys of the Modal, and `esc` last. */
export function storyModalHints(shown: StoryTabId, tabs: TabHints): readonly KeyHint[] {
  const tabHints = shownTabHints(shown, tabs);
  const last = tabHints.at(-1);
  // The `esc` of the tab or of the Modal goes last, where a narrow hint strip keeps it.
  const tabEsc = last?.key === "esc" ? last : undefined;
  const esc = tabEsc ?? (tabs.tabOwnsKeys ? undefined : CLOSE_HINT);

  if (shown === "general") {
    return GENERAL_HINTS;
  }

  return [
    ...(tabEsc ? tabHints.slice(0, -1) : tabHints),
    { key: "ctrl+s", description: "save" },
    IMAGE_PASTE_HINT,
    { key: "shift+tab", description: "next tab", secondary: true },
    ...(esc ? [esc] : []),
  ];
}

/** The size of the padded tabs: the General and Attachments tabs. */
export function generalLayoutOf(width: number, height: number | undefined, summaryRows: number): Layout {
  return {
    width: Math.max(1, width - 2 * STORY_PADDING_X),
    height: height === undefined ? undefined : Math.max(1, height - TABS_HEIGHT - GENERAL_PADDING_Y - summaryRows),
  };
}

/** The size of the Specs and Threads tabs, which reach the frame of the Modal. */
export function specsLayoutOf(width: number, height: number | undefined, summaryRows: number): Layout {
  return {
    width,
    height: height === undefined ? undefined : Math.max(1, height - TABS_HEIGHT - summaryRows),
  };
}
