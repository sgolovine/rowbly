import { Box } from "ink";
import type { ServiceContext } from "../../../../services/workspace/workspace.js";
import { type Layout, LayoutContext } from "../../../hooks/index.js";
import type { KeyHint } from "../../../keymap.js";
import { AttachmentsTab } from "../attachments-tab/index.js";
import { ModelsTab } from "../models-tab/index.js";
import { SpecsTab } from "../specs-tab/index.js";
import type { StageNames } from "../thread-text.js";
import { ThreadsTab } from "../threads-tab/index.js";

/** The Story Modal is flush, so that the Panels of the Specs tab reach its frame. The other parts pad themselves. */
export const STORY_PADDING_X = 2;

/** The tabs of the Story Modal. The position of a tab depends on the tabs before it, so the Modal uses these ids. */
export type StoryTabId = "general" | "specs" | "attachments" | "threads" | "models";

/** The setters that the tabs call to tell the Modal their counts, their key hints and their editing state. */
export interface StoryTabReports {
  readonly setSpecCount: (count: number) => void;
  readonly setSpecEditing: (editing: boolean) => void;
  readonly setSpecHints: (hints: readonly KeyHint[]) => void;
  readonly setThreadCount: (count: number) => void;
  readonly setThreadViewing: (viewing: boolean) => void;
  readonly setThreadHints: (hints: readonly KeyHint[]) => void;
  readonly setAttachmentHints: (hints: readonly KeyHint[]) => void;
  readonly setAttachmentTask: (task: boolean) => void;
  readonly setModelHints: (hints: readonly KeyHint[]) => void;
  readonly setModelTask: (task: boolean) => void;
}

export interface StoryTabPanesProps {
  readonly ctx: ServiceContext;
  readonly storyId: string;
  /** The names of the Stages by key, for the Threads tab. */
  readonly stages?: StageNames;
  /** The Project has Specs on. */
  readonly specs: boolean;
  /** The tab on the screen. */
  readonly shown: StoryTabId;
  /** No confirmation is on top of the Modal. */
  readonly open: boolean;
  /** The size of the Specs and Threads tabs, which reach the frame of the Modal. */
  readonly specsLayout: Layout;
  /** The size of the padded tabs. */
  readonly generalLayout: Layout;
  readonly reports: StoryTabReports;
}

/**
 * The Specs, Threads, Attachments and Models tabs of the Story Modal. All of them stay mounted, so that a change of
 * tab keeps the text that is not saved. Only the tab on the screen is visible.
 */
export function StoryTabPanes({
  ctx,
  storyId,
  stages,
  specs,
  shown,
  open,
  specsLayout,
  generalLayout,
  reports,
}: StoryTabPanesProps) {
  return (
    <>
      <LayoutContext.Provider value={specsLayout}>
        <Box display={shown === "specs" ? "flex" : "none"} flexDirection="column">
          {specs && (
            <SpecsTab
              ctx={ctx}
              storyId={storyId}
              selected={shown === "specs" && open}
              onCount={reports.setSpecCount}
              onEditing={reports.setSpecEditing}
              onHints={reports.setSpecHints}
            />
          )}
        </Box>
        <Box display={shown === "threads" ? "flex" : "none"} flexDirection="column">
          <ThreadsTab
            ctx={ctx}
            storyId={storyId}
            stages={stages}
            selected={shown === "threads" && open}
            onCount={reports.setThreadCount}
            onEditing={reports.setThreadViewing}
            onHints={reports.setThreadHints}
          />
        </Box>
      </LayoutContext.Provider>
      <LayoutContext.Provider value={generalLayout}>
        <Box
          display={shown === "attachments" ? "flex" : "none"}
          flexDirection="column"
          paddingX={STORY_PADDING_X}
          paddingY={1}
        >
          <AttachmentsTab
            ctx={ctx}
            storyId={storyId}
            selected={shown === "attachments" && open}
            onHints={reports.setAttachmentHints}
            onTask={reports.setAttachmentTask}
          />
        </Box>
        <Box
          display={shown === "models" ? "flex" : "none"}
          flexDirection="column"
          paddingX={STORY_PADDING_X}
          paddingY={1}
        >
          <ModelsTab
            ctx={ctx}
            storyId={storyId}
            selected={shown === "models" && open}
            onHints={reports.setModelHints}
            onTask={reports.setModelTask}
          />
        </Box>
      </LayoutContext.Provider>
    </>
  );
}
