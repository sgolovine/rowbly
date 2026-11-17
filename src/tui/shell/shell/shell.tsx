import { Box } from "ink";
import type { FactoryLaunch } from "../../../services/factory/factory.js";
import type { ServiceContext } from "../../../services/workspace/workspace.js";
import { Footer, Sidebar, ToastArea } from "../../components/index.js";
import { FactoryStatusContext, LayoutContext } from "../../hooks/index.js";
import type { KeyHint } from "../../keymap.js";
import { Header } from "../header/index.js";
import { ShellOverlays } from "../shell-overlays/index.js";
import { StoryPanel } from "../story-panel/index.js";
import { StorySidebar } from "../story-sidebar/index.js";
import { useShell } from "./use-shell.js";
import { useShellProps } from "./use-shell-props.js";

/** The project in the directory where Rowbly runs. */
const CWD: ServiceContext = {};

/** One empty list, so the memo children that get no keys keep the same prop. */
const NO_HINTS: readonly KeyHint[] = [];

interface ShellProps {
  readonly ctx?: ServiceContext;
  /** How the Factory controls start the factory process. The CLI entry point supplies it. */
  readonly launch?: FactoryLaunch;
  /** Imports the Pi SDK in the background after the board shows. Only the CLI entry point supplies it. */
  readonly preloadPi?: () => Promise<void>;
}

/**
 * The frame of the app: the header with the Story finder and **+ New Story**, the Stage sidebar, the
 * Story list and the footer. The sidebar filters the list by Stage. When the Project has tags, the tag sidebar
 * shows below the Stage sidebar, in the same column. It filters the list by tag, together with the Stage filter.
 * Drag the right edge of the Stage sidebar to change the width of the two sidebars, and press `ctrl+b` to hide or
 * show them. In a narrow terminal, the sidebars go above the list. With All Stages, the list has one section for each Stage:
 * `enter` or a click on a selected heading expands or collapses it, and `←/→` collapse and expand. `enter`
 * or a click on a Story opens it for editing, and so does a pick in the Story finder. `shift+↑/↓` moves the
 * selected Story up or down its Stage, and past either end into the next Stage. `ctrl+shift+↑/↓` moves it
 * to the previous or next Stage. A drag of a Story to another row moves it there. `d` asks before it
 * deletes the selected Story. `n`, **+ New Story**, `enter` and a click on a Story open the new Story form or
 * the edit form in the Story sidebar on the right of the list. `tab` moves the focus from the Stage sidebar to
 * the tag sidebar, to the list and then to the Story sidebar. In the tag sidebar, `↑/↓` select a tag, `n` and **+ New Tag**
 * open the New Tag Modal, and `esc` gives the focus to the list. Drag the top edge of the tag sidebar to change its
 * height. In the Story sidebar, `esc` gives the focus back to the list and keeps
 * the draft. In the list, `esc` and the `✕` close the Story sidebar, and ask first about unsaved changes. Drag
 * the left edge of the Story sidebar to change its width. `ctrl+o` and the button at the left of the `✕` expand the
 * Story sidebar over the Story list, and collapse it again. In a narrow terminal, the Story sidebar takes the full
 * main area. The Modals that create and edit Stages and the other Modals open over the Story list. The Project
 * Button and `p` open the Project switcher, and each Project that opens is recorded in `~/.rowblyrc.json`.
 * Without a Project in the directory where Rowbly runs, the Story panel shows the onboarding steps, which create one
 * there. A Project in a parent directory does not open. The Factory Button and `f` open the Factory controls. The
 * header shows the state of the factory, which runs in a process of its own and continues after Rowbly quits.
 * The Switch beside the Factory Button and `t` change the list to the Factory view: the worker Threads of all
 * Stories, filtered by the Stage of the sidebar. `enter` or a click on a Thread opens the Thread in the
 * Story sidebar, which then shows the Thread in place of a form.
 */
export function Shell({ ctx: initialCtx = CWD, launch, preloadPi }: ShellProps) {
  const { env, handlers, overlay, factory, factoryState, layout, frame, hints } = useShell(initialCtx, preloadPi);
  const { view } = env;
  const props = useShellProps(handlers, env, frame, factory);
  const cover = frame.story.cover;

  return (
    <FactoryStatusContext.Provider value={factoryState}>
      <Box flexDirection="column" width={layout.width} height={layout.height}>
        <Header {...props.header} />
        <Box flexGrow={1} flexDirection="column">
          <Box flexGrow={1} columnGap={frame.gap} flexDirection={frame.stacked ? "column" : "row"}>
            {view.sidebar && !cover && !props.tags && <Sidebar {...props.sidebar} />}
            {view.sidebar && !cover && props.tags && (
              // The Stage sidebar and the tag sidebar share one column. Only the Stage sidebar drags its width.
              <Box flexDirection="column" flexShrink={0}>
                <Sidebar {...props.sidebar} />
                <Sidebar {...props.tags} />
              </Box>
            )}
            {!cover && frame.listShown && <StoryPanel {...props.panel} />}
            {props.story && <StorySidebar {...props.story} />}
          </Box>
          <Box flexDirection="column" {...frame.overlayBox}>
            <LayoutContext.Provider value={props.overlayLayout}>
              <ShellOverlays
                overlay={overlay}
                board={view.board}
                ctx={env.ctx}
                launch={launch}
                factory={factory}
                // Only the help Modal shows the keys, so the overlays do not render again when the keys change.
                hints={overlay?.kind === "help" ? hints : NO_HINTS}
                on={handlers.overlay}
              />
            </LayoutContext.Provider>
          </Box>
        </Box>
        <Footer hints={overlay ? NO_HINTS : hints} atRoot />
        <ToastArea />
      </Box>
    </FactoryStatusContext.Provider>
  );
}
