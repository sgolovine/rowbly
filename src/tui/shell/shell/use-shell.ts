import { useApp, useInput } from "ink";
import { useContext, useState } from "react";
import type { FactoryStatus } from "../../../services/factory/factory.js";
import type { ServiceContext } from "../../../services/workspace/workspace.js";
import { type Layout, ShellContext, useIsActive, useLayout, useToast } from "../../hooks/index.js";
import type { KeyHint } from "../../keymap.js";
import type { Overlay } from "../overlay.js";
import { type ShellFrame, shellFrame } from "./shell-frame.js";
import { shellHints } from "./shell-hints.js";
import { handleShellKey } from "./shell-keys.js";
import type { ShellEnv } from "./shell-state.js";
import { shellView } from "./shell-view.js";
import { useShellData } from "./use-shell-data.js";
import { useShellState } from "./use-shell-state.js";

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
  const { values, setters } = useShellState();
  const { overlay, sidebarShown, stageKey } = values;
  const toast = useToast();

  const view = shellView({ data, active, ...values });
  const env: ShellEnv = { ctx, view, stageKey, sidebarShown, registry, toast, exit, reload, setCtx, ...setters };

  useInput((input, key) => handleShellKey(env, input, key), { isActive: view.shellKeys });

  return {
    env,
    overlay,
    factory: factory.data,
    layout,
    frame: shellFrame(layout, view, values.sidebarWidth, values.storyWidth),
    hints: shellHints(view, sidebarShown, values.onboardingHints, values.storyHints, values.threadHints),
  };
}
