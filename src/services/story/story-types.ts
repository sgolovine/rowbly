import type { PendingImage } from "../attachment-files/attachment-files.js";
import type { FieldValue } from "../fields/fields.js";

export interface Story {
  /** `ROW-01`. */
  id: string;
  number: number;
  title: string;
  /** A stage key. */
  stage: string;
  /** The 1-based place of the story in its stage. */
  position: number;
  /** The Markdown body. */
  description: string;
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
}

export interface UpdateStoryInput {
  attachments?: readonly PendingImage[];
  id: string;
  title?: string;
  stage?: string;
  /** The 1-based place in the stage, clamped to it. A story that changes stage without one goes last. */
  position?: number;
  description?: string;
  /** Only the fields to change; `null` or `""` clears one. */
  fields?: FieldInput;
}

export interface SearchStoriesInput {
  /** Every word must appear in the ID, title, description or a text field value. */
  query?: string;
  stage?: string;
  /** Stories whose fields equal these values. */
  fields?: FieldInput;
}
