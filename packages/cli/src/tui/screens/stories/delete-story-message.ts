import type { Story } from "../../../services/story/story.js";

/** The question that confirms the deletion of the Story `story`. */
export function deleteStoryMessage(story: Pick<Story, "id" | "title">): string {
  return `Delete ${story.id} ${story.title}? You cannot undo this.`;
}
