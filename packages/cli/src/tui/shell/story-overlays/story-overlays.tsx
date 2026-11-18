import { ConfirmDialog } from "../../components/index.js";
import { deleteStoryMessage } from "../../screens/stories/index.js";
import type { Overlay, OverlayBoard, OverlayHandlers } from "../overlay.js";
import { StoryFinder } from "../story-finder/index.js";

interface StoryOverlaysProps {
  readonly overlay: Overlay | null;
  readonly board: OverlayBoard;
  readonly on: OverlayHandlers;
}

/**
 * The overlays of the Stories of an open Project: the Story finder, the confirmation that discards the
 * unsaved changes of the Story sidebar, and the confirmation that deletes a Story from the list.
 */
export function StoryOverlays({ overlay, board, on }: StoryOverlaysProps) {
  return (
    <>
      {overlay?.kind === "finder" && (
        <StoryFinder stories={board.stories} stages={board.stages} onClose={on.close} onSelect={on.openStory} />
      )}
      {overlay?.kind === "discardStory" && (
        <ConfirmDialog
          title="Discard changes"
          message="Close and discard unsaved changes?"
          confirmLabel="Discard"
          cancelLabel="Keep editing"
          destructive
          onConfirm={() => on.discardStory(overlay.next)}
          onCancel={on.close}
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
