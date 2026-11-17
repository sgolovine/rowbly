// The inbound updates: the changes of the canonical files on the main machine that go to the copy of a running remote
// Thread. The main machine makes them from its base, and the host applies them to the copy.

import type { Attachment } from "../attachment-files/attachment-files.js";
import type { FieldChange } from "../outbox/outbox.js";

/** The changed recorded values of a Story, with `before` and `after`, as in an outbox field entry. */
export interface StoryUpdateBody {
  readonly type: "story.update";
  readonly storyId: string;
  readonly storyUid?: string;
  readonly changes: readonly FieldChange[];
}

/** A Story that is in the canonical files and not in the base. `path` is relative to the copy root. */
export interface StoryCreateBody {
  readonly type: "story.create";
  readonly storyId: string;
  readonly path: string;
  readonly content: string;
}

/** A Story that is in the base and not in the canonical files. */
export interface StoryDeleteBody {
  readonly type: "story.delete";
  readonly storyId: string;
}

/**
 * A new attachment record of a Story. `file` is set when the file is in the attachment cache of the host: the host
 * writes it to the copy. Without `file`, the worker gets the file through the attachment fetch.
 */
export interface AttachmentAddBody {
  readonly type: "attachment.add";
  readonly storyId: string;
  readonly attachment: Attachment;
  readonly file?: string;
}

/** A removed attachment record of a Story. */
export interface AttachmentRemoveBody {
  readonly type: "attachment.remove";
  readonly storyId: string;
  readonly id: string;
}

/** A new or changed text file of the copy that is not a Story or a manifest. The host replaces the full file. */
export interface FilePutBody {
  readonly type: "file.put";
  readonly path: string;
  readonly content: string;
}

/** A text file of the copy that is not in the canonical files now. */
export interface FileDeleteBody {
  readonly type: "file.delete";
  readonly path: string;
}

/** The part of an inbound update that tells the change. */
export type InboundBody =
  | StoryUpdateBody
  | StoryCreateBody
  | StoryDeleteBody
  | AttachmentAddBody
  | AttachmentRemoveBody
  | FilePutBody
  | FileDeleteBody;

/** One inbound update. The `seq` of each Thread starts at 1 and only increases. */
export type InboundUpdate = InboundBody & { readonly seq: number };

/** The types of the inbound updates, version 1. */
export const INBOUND_TYPES: readonly InboundBody["type"][] = [
  "story.update",
  "story.create",
  "story.delete",
  "attachment.add",
  "attachment.remove",
  "file.put",
  "file.delete",
];
