import type { Dispatch, SetStateAction } from "react";
import type { TagConfig } from "../../../services/config/config.js";
import type { FactoryStatus } from "../../../services/factory/factory.js";
import type { FactoryActivity } from "../../../services/factory-activity/factory-activity.js";
import type { Project } from "../../../services/project/project.js";
import type { Stage } from "../../../services/stage/stage.js";
import type { Story } from "../../../services/story/story.js";
import type { ServiceContext } from "../../../services/workspace/workspace.js";
import type { ShellRegistry, ToastStore } from "../../hooks/index.js";
import type { KeyHint } from "../../keymap.js";
import type { storyListRows } from "../../screens/stories/index.js";
import type { Overlay, SidePane } from "../overlay.js";

/** The id of the first sidebar entry, which shows the Stories of every Stage. */
export const ALL_STAGES = "*";

/** The id of the first entry of the tag sidebar, which shows the Stories with any tag or no tag. */
export const ALL_TAGS = "*";

/**
 * The region that has the focus: the Stage sidebar, the tag sidebar, the list, or the sidebar on the right (a Story
 * or a Thread).
 */
export type Pane = "stages" | "tags" | "stories" | "story";

/** What the right Panel shows: the Story list, or the worker Threads of the Factory view. */
export type ViewMode = "stories" | "threads";

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
  /** The right Panel shows the Story list or the Factory view. */
  readonly mode: ViewMode;
  /** The Stage of the filter. A Stage that is gone gives `undefined`, and the list shows every Story again. */
  readonly stage: Stage | undefined;
  readonly rows: readonly StoryListRow[];
  readonly cursor: number;
  readonly row: StoryListRow | undefined;
  /** The Stage of a new Story: the Stage of the filter, or the Stage of the selected row. */
  readonly cursorStage: string | undefined;
  /** The selected sidebar entry. Entry 0 is All Stages. */
  readonly stageIndex: number;
  /** The tags of the Project, in config order. */
  readonly tags: readonly TagConfig[];
  /** The tag of the filter. A tag that is not in the config gives `undefined`, and the list shows every Story again. */
  readonly tag: TagConfig | undefined;
  /** The selected entry of the tag sidebar. Entry 0 is All Tags. */
  readonly tagIndex: number;
  /**
   * The IDs of the Stories of the multi-selection that exist. In the range mode, the Story rows from the anchor to
   * the cursor.
   */
  readonly marked: ReadonlySet<string>;
  /** The range mode is on: `↑/↓` extend the range from the anchor, and `space` selects it. */
  readonly ranging: boolean;

  // The Story sidebar. It also shows a Thread of the Factory view.
  /** What the Story sidebar shows, or `null` when it is closed. */
  readonly storyPane: SidePane | null;
  /** The Story sidebar is open and is the selected pane, also while an overlay is open. */
  readonly storyActive: boolean;

  // The focus.
  /** No overlay is open: the panes take the mouse. */
  readonly idle: boolean;
  /** The shell has the keys: no overlay is open, and the Story sidebar does not have the focus. */
  readonly shellKeys: boolean;
  readonly sidebar: boolean;
  /** The Stage sidebar has the focus. */
  readonly sidebarFocused: boolean;
  /** The tag sidebar shows: the sidebar shows, and the Project has one or more tags. */
  readonly tagSidebar: boolean;
  readonly tagSidebarFocused: boolean;
  readonly listFocused: boolean;
  readonly storyFocused: boolean;
}

/** What the handlers of the shell read and change. */
export interface ShellEnv {
  // The values of the render.
  readonly ctx: ServiceContext;
  readonly view: ShellView;
  readonly stageKey: string | null;
  /** The value of the tag of the filter, or `null` for All Tags. */
  readonly tagKey: string | null;
  readonly sidebarShown: boolean;
  /** The Story sidebar is beside the Story list, so `ctrl+o` and its button can expand or collapse it. */
  readonly storyExpandable: boolean;
  /** The Story sidebar beside the list is expanded, and the Story list does not show. */
  readonly storyExpanded: boolean;
  /** The factory status that the shell polls; `undefined` until the first read completes. */
  readonly factory?: FactoryStatus;

  // The app.
  readonly registry: ShellRegistry;
  readonly toast: ToastStore;
  readonly exit: () => void;
  /** Reads the board again. */
  readonly reload: () => void;
  /**
   * Puts a Story that a write returned on the board in memory, at the top of its Stage, with no read. The watcher
   * echo of the write reads the board again, and also applies the changes of the write to other Stories.
   */
  readonly putOnBoard: (story: Story) => void;
  /** Removes the Story `id` from the board in memory, with no read. The watcher echo of the delete reads the board. */
  readonly takeFromBoard: (id: string) => void;

  // The state setters.
  readonly setCtx: Dispatch<SetStateAction<ServiceContext>>;
  readonly setOverlay: Dispatch<SetStateAction<Overlay | null>>;
  readonly setOnboardingHints: Dispatch<SetStateAction<readonly KeyHint[]>>;
  /** The Factory view gives its keys for the footer. */
  readonly setThreadHints: Dispatch<SetStateAction<readonly KeyHint[]>>;
  readonly setMode: Dispatch<SetStateAction<ViewMode>>;
  readonly setPane: Dispatch<SetStateAction<Pane>>;
  readonly setSidebarWidth: Dispatch<SetStateAction<number>>;
  readonly setSidebarShown: Dispatch<SetStateAction<boolean>>;
  /** The rows of the tag sidebar after a drag of its top edge, or `null` for the default height. */
  readonly setTagsHeight: Dispatch<SetStateAction<number | null>>;
  readonly setStoryPane: Dispatch<SetStateAction<SidePane | null>>;
  /** The width of the Story sidebar after a drag, or `null` for the default width. */
  readonly setStoryWidth: Dispatch<SetStateAction<number | null>>;
  /** Expands or collapses the Story sidebar. The value also applies to a new open with the `remember` option. */
  readonly setStoryExpanded: Dispatch<SetStateAction<boolean>>;
  readonly setStoryHints: Dispatch<SetStateAction<readonly KeyHint[]>>;
  readonly setStageKey: Dispatch<SetStateAction<string | null>>;
  readonly setTagKey: Dispatch<SetStateAction<string | null>>;
  readonly setSelectedId: Dispatch<SetStateAction<string | null>>;
  readonly setCollapsed: Dispatch<SetStateAction<ReadonlySet<string>>>;
  /** Replaces the IDs of the Stories of the multi-selection. */
  readonly setMarked: Dispatch<SetStateAction<ReadonlySet<string>>>;
  /** The Story where the range mode started, or `null` when the range mode is off. */
  readonly setAnchor: Dispatch<SetStateAction<string | null>>;
}
