import { useApp, useInput } from "ink";
import { useContext, useState } from "react";
import type { FactoryStatus } from "../../../services/factory/factory.js";
import type { ServiceContext } from "../../../services/workspace/workspace.js";
import { SIDEBAR_WIDTH } from "../../components/index.js";
import { type Layout, ShellContext, useIsActive, useLayout, useToast } from "../../hooks/index.js";
import type { KeyHint } from "../../keymap.js";
import type { Overlay, StoryPane } from "../overlay.js";
import { type ShellFrame, shellFrame } from "./shell-frame.js";
import { shellHints } from "./shell-hints.js";
import { handleShellKey } from "./shell-keys.js";
import type { Pane, ShellEnv } from "./shell-state.js";
import { shellView } from "./shell-view.js";
import { useShellData } from "./use-shell-data.js";

/** What the shell renders. */
export interface ShellModel {
  readonly env: ShellEnv;
  readonly overlay: Overlay | null;
  readonly factory: FactoryStatus | undefined;
  readonly layout: Layout;
  readonly frame: ShellFrame;
  readonly hints: KeyHint[];
}

/** The state, the data and the keys of the shell. */
export function useShell(initialCtx: ServiceContext): ShellModel {
  const { exit } = useApp();
  // The Project switcher changes where the services look.
  const [ctx, setCtx] = useState(initialCtx);
  const active = useIsActive();
  const registry = useContext(ShellContext);
  const layout = useLayout();
  const { data, factory, reload } = useShellData(ctx);
  const [overlay, setOverlay] = useState<Overlay | null>(null);
  const [onboardingHints, setOnboardingHints] = useState<readonly KeyHint[]>([]);
  const [pane, setPane] = useState<Pane>("stories");
  // Dragged with the mouse and toggled with `ctrl+b`; both last until Rowbly quits.
  const [sidebarWidth, setSidebarWidth] = useState(SIDEBAR_WIDTH);
  const [sidebarShown, setSidebarShown] = useState(true);
  // What the Story sidebar shows, and its width after a drag (`null` for the default width) until Rowbly quits.
  const [storyPane, setStoryPane] = useState<StoryPane | null>(null);
  const [storyWidth, setStoryWidth] = useState<number | null>(null);
  const [storyHints, setStoryHints] = useState<readonly KeyHint[]>([]);
  const [stageKey, setStageKey] = useState<string | null>(null);
  // The id of the selected row: a Story id, or the `stageRowId` of a section heading.
  const [selectedId, setSelectedId] = useState<string | null>(null);
  // The Stage sections that are collapsed in All Stages; they last until Rowbly quits.
  const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(new Set());
  const toast = useToast();

  const view = shellView({ data, active, overlay, pane, storyPane, sidebarShown, stageKey, selectedId, collapsed });
  const env: ShellEnv = {
    ctx,
    view,
    stageKey,
    sidebarShown,
    registry,
    toast,
    exit,
    reload,
    setCtx,
    setOverlay,
    setOnboardingHints,
    setPane,
    setSidebarWidth,
    setSidebarShown,
    setStoryPane,
    setStoryWidth,
    setStoryHints,
    setStageKey,
    setSelectedId,
    setCollapsed,
  };

  useInput((input, key) => handleShellKey(env, input, key), { isActive: view.shellKeys });

  return {
    env,
    overlay,
    factory: factory.data,
    layout,
    frame: shellFrame(layout, view, sidebarWidth, storyWidth),
    hints: shellHints(view, sidebarShown, onboardingHints, storyHints),
  };
}
