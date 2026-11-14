import type { Project } from "../../services/project/project.js";
import type { Stage } from "../../services/stage/stage.js";
import type { Story } from "../../services/story/story.js";
import type { ThreadRecord } from "../../services/thread/thread.js";

/** What the Story sidebar shows: the form of a new Story, or the edit form of a Story. */
export type StoryPane = { readonly kind: "new" } | { readonly kind: "edit"; readonly story: Story };

/** The Modal or the finder that the shell shows over the Story list. */
export type Overlay =
  | { readonly kind: "finder" }
  | { readonly kind: "projects" }
  | { readonly kind: "help" }
  | { readonly kind: "settings"; readonly section?: string }
  /** The Story sidebar has unsaved changes. A confirmation shows `next` in the Story sidebar, or closes it with `null`. */
  | { readonly kind: "discardStory"; readonly next: StoryPane | null }
  | { readonly kind: "deleteStory"; readonly story: Story }
  | { readonly kind: "newStage" }
  | { readonly kind: "editStage"; readonly stage: Stage }
  | { readonly kind: "factory" }
  | { readonly kind: "thread"; readonly thread: ThreadRecord };

/** The records of an open Project that the overlays show. */
export interface OverlayBoard {
  readonly project: Project;
  readonly stages: readonly Stage[];
  readonly stories: readonly Story[];
}

/** What the overlays do when they close or change a record. */
export interface OverlayHandlers {
  close(): void;
  /** A pick in the Story finder: show the Story in the list and open it. */
  openStory(story: Story): void;
  /** The discard of the changes in the Story sidebar was confirmed. */
  discardStory(next: StoryPane | null): void;
  /** The delete of a Story was confirmed. */
  removeStory(story: Story): void;
  stageSaved(stage: Stage): void;
  openAiSettings(): void;
  switchProject(path: string): void;
  reload(): void;
}
