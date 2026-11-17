import { useState } from "react";
import { SIDEBAR_WIDTH } from "../../components/index.js";
import type { KeyHint } from "../../keymap.js";
import type { Overlay, SidePane } from "../overlay.js";
import type { Pane, ViewMode } from "./shell-state.js";

/** The filters of the Story list: the key of the Stage and the value of the tag, or `null` for All Stages and All Tags. */
function useFilterState() {
  const [stageKey, setStageKey] = useState<string | null>(null);
  const [tagKey, setTagKey] = useState<string | null>(null);

  return { values: { stageKey, tagKey }, setters: { setStageKey, setTagKey } };
}

/** The state of the shell that lasts until Rowbly quits: the overlay, the focus, the panes and the selection. */
export function useShellState() {
  const [overlay, setOverlay] = useState<Overlay | null>(null);
  const [onboardingHints, setOnboardingHints] = useState<readonly KeyHint[]>([]);
  const [threadHints, setThreadHints] = useState<readonly KeyHint[]>([]);
  const [pane, setPane] = useState<Pane>("stories");
  // The Switch in the header and `t` change it.
  const [mode, setMode] = useState<ViewMode>("stories");
  // Dragged with the mouse and toggled with `ctrl+b`.
  const [sidebarWidth, setSidebarWidth] = useState(SIDEBAR_WIDTH);
  const [sidebarShown, setSidebarShown] = useState(true);
  // What the Story sidebar shows, and its width after a drag (`null` for the default width).
  const [storyPane, setStoryPane] = useState<SidePane | null>(null);
  const [storyWidth, setStoryWidth] = useState<number | null>(null);
  // The Story sidebar takes the columns of the Story list. With the `remember` option, it is also the last selection.
  const [storyExpanded, setStoryExpanded] = useState(false);
  const [storyHints, setStoryHints] = useState<readonly KeyHint[]>([]);
  const filters = useFilterState();
  // The id of the selected row: a Story id, or the `stageRowId` of a section heading.
  const [selectedId, setSelectedId] = useState<string | null>(null);
  // The Stage sections that are collapsed in All Stages.
  const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(new Set());
  // The multi-selection of the Story list: the IDs of the selected Stories, and the Story where the range mode started.
  const [marked, setMarked] = useState<ReadonlySet<string>>(new Set());
  const [anchor, setAnchor] = useState<string | null>(null);

  return {
    values: {
      overlay,
      onboardingHints,
      threadHints,
      pane,
      mode,
      sidebarWidth,
      sidebarShown,
      storyPane,
      storyWidth,
      storyExpanded,
      storyHints,
      ...filters.values,
      selectedId,
      collapsed,
      marked,
      anchor,
    },
    setters: {
      setOverlay,
      setOnboardingHints,
      setThreadHints,
      setMode,
      setPane,
      setSidebarWidth,
      setSidebarShown,
      setStoryPane,
      setStoryWidth,
      setStoryExpanded,
      setStoryHints,
      ...filters.setters,
      setSelectedId,
      setCollapsed,
      setMarked,
      setAnchor,
    },
  };
}
