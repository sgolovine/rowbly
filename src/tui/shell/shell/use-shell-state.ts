import { useState } from "react";
import { SIDEBAR_WIDTH } from "../../components/index.js";
import type { KeyHint } from "../../keymap.js";
import type { Overlay, SidePane } from "../overlay.js";
import type { Pane, ViewMode } from "./shell-state.js";

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
  const [storyHints, setStoryHints] = useState<readonly KeyHint[]>([]);
  const [stageKey, setStageKey] = useState<string | null>(null);
  // The id of the selected row: a Story id, or the `stageRowId` of a section heading.
  const [selectedId, setSelectedId] = useState<string | null>(null);
  // The Stage sections that are collapsed in All Stages.
  const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(new Set());

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
      storyHints,
      stageKey,
      selectedId,
      collapsed,
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
      setStoryHints,
      setStageKey,
      setSelectedId,
      setCollapsed,
    },
  };
}
