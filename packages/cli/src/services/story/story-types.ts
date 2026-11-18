import type { PendingImage } from "../attachment-files/attachment-files.js";
import type { FieldValue } from "../fields/fields.js";

export interface Story {
  /** `ROW-01`. */
  id: string;
  number: number;
  /** The permanent identity of the story: a UUID. It does not change when the number changes. `undefined` when the file has no `uid`. */
  uid?: string;
  title: string;
  /** A stage key. */
  stage: string;
  /** The 1-based place of the story in its stage, by `updatedAt`: the most recent first. */
  position: number;
  /** The IDs of the upstream Stories, in the saved order. `[]` when the story has no dependencies. */
  dependsOn: string[];
  /** The values of the tags of the story, in the saved order. `[]` when the story has no tags. */
  tags: string[];
  /** The ISO 8601 UTC time when the story was created. `null` when the file has no valid value. */
  createdAt: string | null;
  /** The ISO 8601 UTC time of the last change of the story. `null` when the file has no valid value. */
  updatedAt: string | null;
  /** The Markdown body. */
  description: string;
  /**
   * The Git branch of the Story from the `branch` frontmatter key. The repair of a duplicate Story ID writes it. A
   * Story without it uses `story/<ID>`.
   */
  branch?: string;
  /** A value for every custom field in the project, `null` when unset. */
  fields: Record<string, FieldValue>;
  path: string;
  /** Saved images only. */
  attachmentCount?: number;
}

/**
 * Custom field values by key. A string is parsed by the field's type, so text input works as-is.
 * @public
 */
export type FieldInput = Record<string, unknown>;

export interface CreateStoryInput {
  attachments?: readonly PendingImage[];
  title: string;
  /** A stage key. Defaults to the first enabled stage. */
  stage?: string;
  description?: string;
  fields?: FieldInput;
  /** The IDs of the upstream Stories. `row-1` and `1` are saved as `ROW-01`. */
  dependsOn?: readonly string[];
  /** The tag values. Each value must be a tag of the project. */
  tags?: readonly string[];
}

export interface UpdateStoryInput {
  attachments?: readonly PendingImage[];
  id: string;
  title?: string;
  stage?: string;
  description?: string;
  /** Only the fields to change; `null` or `""` clears one. */
  fields?: FieldInput;
  /** Replaces the list of upstream Stories. `[]` removes all of them. `undefined` keeps the old list. */
  dependsOn?: readonly string[];
  /** Upstream Stories to add to the old list. Not together with `dependsOn`. */
  addDependsOn?: readonly string[];
  /** Upstream Stories to remove from the old list. Not together with `dependsOn`. */
  removeDependsOn?: readonly string[];
  /** Replaces the list of tag values. `[]` removes all of them. `undefined` keeps the old list. */
  tags?: readonly string[];
  /** Tag values to add to the old list. Not together with `tags`. */
  addTags?: readonly string[];
  /** Tag values to remove from the old list. Not together with `tags`. */
  removeTags?: readonly string[];
}

/** A Story with its dependency state. */
export interface StoryDetails extends Story {
  /** The IDs of the downstream Stories. */
  blocks: string[];
  /** The IDs of the upstream Stories that are not complete. The Story is blocked when the list is not empty. */
  waitingFor: string[];
}

/** The result of a delete: the ID, and a warning for each downstream Story that lost the dependency. */
export interface DeleteStoryResult {
  id: string;
  warnings: string[];
}

export interface SearchStoriesInput {
  /** Every word must appear in the ID, title, description or a text field value. */
  query?: string;
  stage?: string;
  /** Stories whose fields equal these values. */
  fields?: FieldInput;
  /** Only blocked Stories, or only ready Stories. */
  dependency?: "blocked" | "ready";
  /** Only Stories that have all of these tag values. */
  tags?: readonly string[];
}
