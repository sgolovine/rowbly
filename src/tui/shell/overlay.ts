import type { Project } from "../../services/project/project.js";
import type { Stage } from "../../services/stage/stage.js";
import type { Story } from "../../services/story/story.js";

/** The Modal or the finder that the shell shows over the Story list. */
export type Overlay =
  | { readonly kind: "finder" }
  | { readonly kind: "projects" }
  | { readonly kind: "help" }
  | { readonly kind: "settings"; readonly section?: string }
  | { readonly kind: "newStory" }
  | { readonly kind: "editStory"; readonly story: Story }
  | { readonly kind: "deleteStory"; readonly story: Story }
  | { readonly kind: "newStage" }
  | { readonly kind: "editStage"; readonly stage: Stage }
  | { readonly kind: "factory" };

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
  /** A Story was created or saved: show it in the list. */
  storySaved(story: Story): void;
  storyDeleted(id: string): void;
  /** The delete of a Story was confirmed. */
  removeStory(story: Story): void;
  stageSaved(stage: Stage): void;
  openAiSettings(): void;
  switchProject(path: string): void;
  reload(): void;
}
