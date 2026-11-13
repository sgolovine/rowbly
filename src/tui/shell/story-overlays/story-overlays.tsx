import type { ServiceContext } from "../../../services/workspace/workspace.js";
import { ConfirmDialog } from "../../components/index.js";
import { deleteStoryMessage, EditStoryModal, NewStoryModal } from "../../screens/stories/index.js";
import type { Overlay, OverlayBoard, OverlayHandlers } from "../overlay.js";
import { StoryFinder } from "../story-finder/index.js";

interface StoryOverlaysProps {
  readonly overlay: Overlay | null;
  readonly board: OverlayBoard;
  readonly ctx: ServiceContext;
  /** The Stage that a new Story starts in. */
  readonly cursorStage: string | undefined;
  readonly on: OverlayHandlers;
}

/** The overlays of the Stories of an open Project: the Story finder, and the Modals that create, edit and delete a Story. */
export function StoryOverlays({ overlay, board, ctx, cursorStage, on }: StoryOverlaysProps) {
  return (
    <>
      {overlay?.kind === "finder" && (
        <StoryFinder stories={board.stories} stages={board.stages} onClose={on.close} onSelect={on.openStory} />
      )}
      {overlay?.kind === "newStory" && (
        <NewStoryModal
          ctx={ctx}
          stages={board.stages}
          customFields={board.project.customFields}
          stage={cursorStage}
          onClose={on.close}
          onCreated={on.storySaved}
        />
      )}
      {overlay?.kind === "editStory" && (
        <EditStoryModal
          ctx={ctx}
          story={overlay.story}
          stages={board.stages}
          customFields={board.project.customFields}
          specs={board.project.features?.specs === true}
          onClose={on.close}
          onSaved={on.storySaved}
          onDeleted={on.storyDeleted}
        />
      )}
      {overlay?.kind === "deleteStory" && (
        <ConfirmDialog
          title={`Delete Story › ${overlay.story.id}`}
          message={deleteStoryMessage(overlay.story)}
          confirmLabel="Delete"
          cancelLabel="Cancel"
          destructive
          onConfirm={() => on.removeStory(overlay.story)}
          onCancel={on.close}
        />
      )}
    </>
  );
}
