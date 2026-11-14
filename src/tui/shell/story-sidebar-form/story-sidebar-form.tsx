import type { Story } from "../../../services/story/story.js";
import type { ServiceContext } from "../../../services/workspace/workspace.js";
import type { KeyHint } from "../../keymap.js";
import { EditStoryForm, NewStoryForm } from "../../screens/stories/index.js";
import type { OverlayBoard, StoryPane } from "../overlay.js";

export interface StorySidebarFormProps {
  readonly pane: StoryPane;
  readonly board: OverlayBoard;
  readonly ctx: ServiceContext;
  /** The Stage that a new Story starts in. */
  readonly cursorStage: string | undefined;
  /** `esc` in the form. */
  onBack(): void;
  onSaved(story: Story): void;
  onDeleted(id: string): void;
  /** The keys of the tab of the edit form. */
  onHints(hints: readonly KeyHint[]): void;
}

/** The form in the Story sidebar: the form of a new Story, or the edit form of a Story with its tabs. */
export function StorySidebarForm({ pane, board, ctx, cursorStage, ...on }: StorySidebarFormProps) {
  if (pane.kind === "new") {
    return (
      <NewStoryForm
        ctx={ctx}
        stages={board.stages}
        customFields={board.project.customFields}
        stage={cursorStage}
        onCreated={on.onSaved}
        onBack={on.onBack}
      />
    );
  }

  return (
    <EditStoryForm
      ctx={ctx}
      story={pane.story}
      stages={board.stages}
      customFields={board.project.customFields}
      specs={board.project.features?.specs === true}
      onSaved={on.onSaved}
      onDeleted={on.onDeleted}
      onBack={on.onBack}
      onHints={on.onHints}
    />
  );
}
