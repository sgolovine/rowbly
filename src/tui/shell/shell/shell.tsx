import { Box } from "ink";
import type { FactoryLaunch } from "../../../services/factory/factory.js";
import type { ServiceContext } from "../../../services/workspace/workspace.js";
import { Footer, Sidebar, ToastArea } from "../../components/index.js";
import { LayoutContext } from "../../hooks/index.js";
import { Header } from "../header/index.js";
import { ShellOverlays } from "../shell-overlays/index.js";
import { StoryPanel } from "../story-panel/index.js";
import { StorySidebar } from "../story-sidebar/index.js";
import { headerProps, overlayHandlers, stageSidebarProps, storyPanelProps, storySidebarProps } from "./shell-props.js";
import { useShell } from "./use-shell.js";

/** The project in the directory where Rowbly runs. */
const CWD: ServiceContext = {};

interface ShellProps {
  readonly ctx?: ServiceContext;
  /** How the Factory controls start the factory process. The CLI entry point supplies it. */
  readonly launch?: FactoryLaunch;
}

/**
 * The frame of the app: the header with the Story finder and **+ New Story**, the Stage sidebar, the
 * Story list and the footer. The sidebar filters the list by Stage. Drag its right edge to change its
 * width, and press `ctrl+b` to hide or show it. In a narrow terminal, the sidebar goes above the list. With All Stages, the list has one section for each Stage:
 * `enter` or a click on a selected heading expands or collapses it, and `←/→` collapse and expand. `enter`
 * or a click on a Story opens it for editing, and so does a pick in the Story finder. `shift+↑/↓` moves the
 * selected Story up or down its Stage, and past either end into the next Stage. `ctrl+shift+↑/↓` moves it
 * to the previous or next Stage. A drag of a Story to another row moves it there. `d` asks before it
 * deletes the selected Story. `n`, **+ New Story**, `enter` and a click on a Story open the new Story form or
 * the edit form in the Story sidebar on the right of the list. `tab` moves the focus from the Stage sidebar to
 * the list and then to the Story sidebar. In the Story sidebar, `esc` gives the focus back to the list and keeps
 * the draft. In the list, `esc` and the `✕` close the Story sidebar, and ask first about unsaved changes. Drag
 * the left edge of the Story sidebar to change its width. In a narrow terminal, the Story sidebar takes the full
 * main area. The Modals that create and edit Stages and the other Modals open over the Story list. The Project
 * Button and `p` open the Project switcher, and each Project that opens is recorded in `~/.rowblyrc.json`.
 * Without a Project in the directory where Rowbly runs, the Story panel shows the onboarding steps, which create one
 * there. A Project in a parent directory does not open. The Factory Button and `f` open the Factory controls. The
 * header shows the state of the factory, which runs in a process of its own and continues after Rowbly quits.
 * The Switch beside the Factory Button and `t` change the list to the Factory view: the worker Threads of all
 * Stories, filtered by the Stage of the sidebar. `enter` or a click on a Thread opens the Thread Modal.
 */
export function Shell({ ctx: initialCtx = CWD, launch }: ShellProps) {
  const { env, overlay, factory, layout, frame, hints } = useShell(initialCtx);
  const { view } = env;
  const story = storySidebarProps(env, frame);
  const cover = frame.story.cover;

  return (
    <Box flexDirection="column" width={layout.width} height={layout.height}>
      <Header {...headerProps(env, factory)} />
      <Box flexGrow={1} flexDirection="column">
        <Box flexGrow={1} columnGap={frame.gap} flexDirection={frame.stacked ? "column" : "row"}>
          {view.sidebar && !cover && <Sidebar {...stageSidebarProps(env, frame)} />}
          {!cover && <StoryPanel {...storyPanelProps(env, frame)} />}
          {story && <StorySidebar {...story} />}
        </Box>
        <Box flexDirection="column" {...frame.overlayBox}>
          <LayoutContext.Provider value={{ width: frame.overlayWidth, height: frame.overlayHeight }}>
            <ShellOverlays
              overlay={overlay}
              board={view.board}
              ctx={env.ctx}
              launch={launch}
              factory={factory}
              hints={hints}
              on={overlayHandlers(env)}
            />
          </LayoutContext.Provider>
        </Box>
      </Box>
      <Footer hints={overlay ? [] : hints} atRoot />
      <ToastArea />
    </Box>
  );
}
