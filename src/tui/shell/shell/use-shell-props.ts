import { type ComponentProps, useMemo } from "react";
import type { FactoryStatus } from "../../../services/factory/factory.js";
import type { Sidebar } from "../../components/index.js";
import type { Layout } from "../../hooks/index.js";
import type { Header } from "../header/index.js";
import type { StoryPanel, StoryPanelBody } from "../story-panel/index.js";
import type { StorySidebarExpand, StorySidebarProps } from "../story-sidebar/index.js";
import type { ShellFrame } from "./shell-frame.js";
import type { ShellHandlers } from "./shell-handlers.js";
import {
  headerProps,
  panelBody,
  panelTitle,
  stageEntries,
  stageSidebarProps,
  storySidebarProps,
} from "./shell-props.js";
import type { ShellEnv, ShellView } from "./shell-state.js";

/** The props of the children of the shell. */
export interface ShellChildProps {
  readonly header: ComponentProps<typeof Header>;
  readonly sidebar: ComponentProps<typeof Sidebar>;
  readonly panel: ComponentProps<typeof StoryPanel>;
  /** `undefined` while the Story sidebar is closed. */
  readonly story: StorySidebarProps | undefined;
  /** The area where the overlays are centred. */
  readonly overlayLayout: Layout;
}

/** The header props keep their references while their values do not change. */
function useHeaderProps(
  handlers: ShellHandlers,
  view: ShellView,
  factory: FactoryStatus | undefined,
): ComponentProps<typeof Header> {
  const { board, idle, loading, sidebarFocused, storyFocused, mode } = view;
  const name = board?.project.projectName ?? (loading ? "Loading…" : "No Project");
  const open = board !== undefined;
  const threads = mode === "threads";
  const showKey = !sidebarFocused && !storyFocused && mode === "stories";

  return useMemo(
    () => headerProps(handlers, { name, open, factory, threads, showKey, clickable: idle }),
    [handlers, name, open, factory, threads, showKey, idle],
  );
}

/** The entries keep their reference while the Stages of the board do not change. */
function useStageSidebarProps(handlers: ShellHandlers, view: ShellView, frame: ShellFrame) {
  const { stages } = view;
  const entries = useMemo(() => stageEntries(stages), [stages]);
  const button = useMemo(() => ({ label: "+ New Stage", onClick: handlers.openNewStage }), [handlers]);

  return stageSidebarProps(handlers, view, frame, { entries, button });
}

/** The body keeps its reference while its values do not change. */
function usePanelBody(handlers: ShellHandlers, env: ShellEnv, frame: ShellFrame): StoryPanelBody {
  const { ctx } = env;
  const { board, loading, noProject, mode, stage, rows, cursor, marked, idle, listFocused } = env.view;
  const { statusLine, listInnerHeight } = frame;

  return useMemo(
    () =>
      panelBody(handlers, {
        ctx,
        board,
        loading,
        noProject,
        mode,
        stage,
        rows,
        cursor,
        marked,
        idle,
        listFocused,
        statusLine,
        listInnerHeight,
      }),
    [
      handlers,
      ctx,
      board,
      loading,
      noProject,
      mode,
      stage,
      rows,
      cursor,
      marked,
      idle,
      listFocused,
      statusLine,
      listInnerHeight,
    ],
  );
}

/** The Panel of the Story list. */
function useStoryPanelProps(
  handlers: ShellHandlers,
  env: ShellEnv,
  frame: ShellFrame,
): ComponentProps<typeof StoryPanel> {
  const { mainWidth, listInnerHeight } = frame;
  const inner = useMemo(() => ({ width: mainWidth, height: listInnerHeight }), [mainWidth, listInnerHeight]);
  const body = usePanelBody(handlers, env, frame);

  return {
    title: panelTitle(env.view),
    focused: env.view.listFocused,
    height: frame.listHeight,
    inner,
    onClick: env.view.idle ? handlers.focusStories : undefined,
    body,
  };
}

/** The expand button keeps its reference while the Story sidebar does not expand or collapse. */
function useStorySidebarProps(handlers: ShellHandlers, env: ShellEnv, frame: ShellFrame) {
  const { storyExpandable } = env;
  const { expanded } = frame.story;
  const expand = useMemo<StorySidebarExpand | undefined>(
    () => (storyExpandable ? { expanded, onToggle: handlers.toggleExpanded } : undefined),
    [handlers, storyExpandable, expanded],
  );

  return storySidebarProps(handlers, env, frame, expand);
}

/**
 * The props of the children of the shell. Each nested object, array and handler keeps its reference while its values
 * do not change, so a memo child renders again only when its values change.
 */
export function useShellProps(
  handlers: ShellHandlers,
  env: ShellEnv,
  frame: ShellFrame,
  factory: FactoryStatus | undefined,
): ShellChildProps {
  const { overlayWidth, overlayHeight } = frame;

  return {
    header: useHeaderProps(handlers, env.view, factory),
    sidebar: useStageSidebarProps(handlers, env.view, frame),
    panel: useStoryPanelProps(handlers, env, frame),
    story: useStorySidebarProps(handlers, env, frame),
    overlayLayout: useMemo(() => ({ width: overlayWidth, height: overlayHeight }), [overlayWidth, overlayHeight]),
  };
}
