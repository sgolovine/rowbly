import type { Dispatch, SetStateAction } from "react";
import type { FactoryActivity } from "../../../services/factory-activity/factory-activity.js";
import type { Project } from "../../../services/project/project.js";
import type { Stage } from "../../../services/stage/stage.js";
import type { Story } from "../../../services/story/story.js";
import type { ServiceContext } from "../../../services/workspace/workspace.js";
import type { ShellRegistry, ToastStore } from "../../hooks/index.js";
import type { KeyHint } from "../../keymap.js";
import type { storyListRows } from "../../screens/stories/index.js";
import type { Overlay } from "../overlay.js";

/** The id of the first sidebar entry, which shows the Stories of every Stage. */
export const ALL_STAGES = "*";

/** The region that takes `↑/↓`, `n` and the other keys of a list: the Stage sidebar or the Story list. */
export type Pane = "stages" | "stories";

/** A row of the Story list: a Stage heading or a Story. */
export type StoryListRow = ReturnType<typeof storyListRows>[number];

/** The records of an open Project. */
export interface Board {
  readonly project: Project;
  readonly stages: Stage[];
  readonly stories: Story[];
  readonly activity: FactoryActivity;
}

/** The values that the shell derives from its data and its state in each render. */
export interface ShellView {
  // The data.
  readonly board: Board | undefined;
  /** The board loads, also when a reload replaces a board on screen. */
  readonly loading: boolean;
  /** The directory where Rowbly runs has no Project. */
  readonly noProject: boolean;
  readonly stages: readonly Stage[];
  readonly stories: readonly Story[];

  // The Story list.
  /** The Stage of the filter. A Stage that is gone gives `undefined`, and the list shows every Story again. */
  readonly stage: Stage | undefined;
  readonly rows: readonly StoryListRow[];
  readonly cursor: number;
  readonly row: StoryListRow | undefined;
  /** The Stage of a new Story: the Stage of the filter, or the Stage of the selected row. */
  readonly cursorStage: string | undefined;
  /** The selected sidebar entry. Entry 0 is All Stages. */
  readonly stageIndex: number;

  // The focus.
  /** The shell has the keys: no overlay is open. */
  readonly idle: boolean;
  readonly sidebar: boolean;
  readonly sidebarFocused: boolean;
  readonly listFocused: boolean;
}

/** What the handlers of the shell read and change. */
export interface ShellEnv {
  // The values of the render.
  readonly ctx: ServiceContext;
  readonly view: ShellView;
  readonly stageKey: string | null;
  readonly sidebarShown: boolean;

  // The app.
  readonly registry: ShellRegistry;
  readonly toast: ToastStore;
  readonly exit: () => void;
  /** Reads the board again. */
  readonly reload: () => void;

  // The state setters.
  readonly setCtx: Dispatch<SetStateAction<ServiceContext>>;
  readonly setOverlay: Dispatch<SetStateAction<Overlay | null>>;
  readonly setOnboardingHints: Dispatch<SetStateAction<readonly KeyHint[]>>;
  readonly setPane: Dispatch<SetStateAction<Pane>>;
  readonly setSidebarWidth: Dispatch<SetStateAction<number>>;
  readonly setSidebarShown: Dispatch<SetStateAction<boolean>>;
  readonly setStageKey: Dispatch<SetStateAction<string | null>>;
  readonly setSelectedId: Dispatch<SetStateAction<string | null>>;
  readonly setCollapsed: Dispatch<SetStateAction<ReadonlySet<string>>>;
}
