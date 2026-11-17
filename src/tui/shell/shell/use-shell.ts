import { useApp, useInput } from "ink";
import { useContext, useMemo, useState } from "react";
import type { FactoryStatus } from "../../../services/factory/factory.js";
import type { ServiceContext } from "../../../services/workspace/workspace.js";
import { type AsyncState, type Layout, ShellContext, useIsActive, useLayout, useToast } from "../../hooks/index.js";
import type { KeyHint } from "../../keymap.js";
import type { Overlay } from "../overlay.js";
import { type ShellFrame, shellFrame } from "./shell-frame.js";
import { shellHints } from "./shell-hints.js";
import { handleShellKey } from "./shell-keys.js";
import type { ShellEnv } from "./shell-state.js";
import { shellRows, shellView } from "./shell-view.js";
import { useShellData } from "./use-shell-data.js";
import { useShellState } from "./use-shell-state.js";
import { useStageDefaults } from "./use-stage-defaults.js";

/** What the shell renders. */
export interface ShellModel {
  readonly env: ShellEnv;
  readonly overlay: Overlay | null;
  readonly factory: FactoryStatus | undefined;
  /** The one factory status read, which the views in the shell share. */
  readonly factoryState: AsyncState<FactoryStatus | undefined>;
  readonly layout: Layout;
  readonly frame: ShellFrame;
  readonly hints: KeyHint[];
}

/** The state, the data and the keys of the shell. `preloadPi` imports the Pi SDK after the board shows. */
export function useShell(initialCtx: ServiceContext, preloadPi?: () => Promise<void>): ShellModel {
  const { exit } = useApp();
  // The Project switcher changes where the services look.
  const [ctx, setCtx] = useState(initialCtx);
  const active = useIsActive();
  const registry = useContext(ShellContext);
  const layout = useLayout();
  const { data, factory, reload } = useShellData(ctx, preloadPi);
  const { values, setters } = useShellState();
  const { overlay, sidebarShown, stageKey, collapsed } = values;
  const toast = useToast();

  useStageDefaults(data.data, setters.setCollapsed);

  // Only a change of the board, the Stage filter or the collapsed Stages builds the rows again, not a cursor move.
  const rows = useMemo(() => shellRows(data.data, stageKey, collapsed), [data.data, stageKey, collapsed]);
  const view = shellView({ data, active, ...values, rows });
  const frame = shellFrame(layout, view, values.sidebarWidth, values.storyWidth, values.storyExpanded);
  const env: ShellEnv = {
    ctx,
    view,
    stageKey,
    sidebarShown,
    storyExpandable: frame.story.mode === "beside",
    storyExpanded: frame.story.expanded,
    factory: factory.data,
    registry,
    toast,
    exit,
    reload,
    setCtx,
    ...setters,
  };

  useInput((input, key) => handleShellKey(env, input, key), { isActive: view.shellKeys });

  return {
    env,
    overlay,
    factory: factory.data,
    factoryState: factory,
    layout,
    frame,
    hints: shellHints(view, sidebarShown, values.onboardingHints, values.storyHints, values.threadHints),
  };
}
