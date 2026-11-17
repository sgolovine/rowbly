// The diff of the base of a remote Thread and the current canonical files. Each difference becomes an inbound update.
// The diff is pure: the caller reads the files.

import { isDeepStrictEqual } from "node:util";
import type { Attachment } from "../attachment-files/attachment-files.js";
import { type MarkdownDocument, parseMarkdown } from "../markdown/markdown.js";
import { storyChanges } from "../outbox/outbox.js";
import { storyUidField } from "../story/story-ref.js";
import { parseStoryFileName } from "../story-files/story-files.js";
import type { CopyFile, ThreadCopy } from "../thread-copy/thread-copy.js";
import type {
  AttachmentAddBody,
  AttachmentRemoveBody,
  FileDeleteBody,
  FilePutBody,
  InboundBody,
  StoryCreateBody,
  StoryDeleteBody,
  StoryUpdateBody,
} from "./inbound-types.js";

/** The input of the diff: the base, the canonical files in the same form, and the custom field keys of the config. */
export interface InboundDiffInput {
  readonly base: ThreadCopy;
  readonly current: ThreadCopy;
  readonly fieldKeys: readonly string[];
}

/** The files of a copy, by their kind. Stories and manifests are by Story ID. */
interface SortedFiles {
  readonly stories: ReadonlyMap<string, CopyFile>;
  readonly manifests: ReadonlyMap<string, readonly Attachment[]>;
  readonly other: ReadonlyMap<string, string>;
}

/** The kind of a copy file: a Story file, an attachment manifest or an other text file. */
type FileKind =
  | { readonly kind: "story"; readonly storyId: string }
  | { readonly kind: "manifest"; readonly storyId: string }
  | { readonly kind: "other" };

const MANIFEST = "manifest.json";

/** Gives the kind of a copy path. A Story is identified by its file name, because a Stage move changes the path. */
export function copyFileKind(path: string): FileKind {
  const parts = path.split("/");
  const name = parts.at(-1) ?? "";

  if (parts[1] === "stories" && parts.length >= 3 && parts.length <= 4 && parseStoryFileName(name)) {
    return { kind: "story", storyId: name.slice(0, -".md".length) };
  }

  if (parts[1] === "attachments" && parts.length === 4 && name === MANIFEST) {
    return { kind: "manifest", storyId: parts[2] ?? "" };
  }

  return { kind: "other" };
}

function isRecord(value: unknown): value is Attachment {
  return typeof value === "object" && value !== null && typeof (value as { id?: unknown }).id === "string";
}

/** Gives the records of a manifest text. A text that is not a list of records gives no records. */
function manifestRecords(content: string): Attachment[] {
  try {
    const value: unknown = JSON.parse(content);

    return Array.isArray(value) ? value.filter(isRecord) : [];
  } catch {
    return [];
  }
}

function sortFiles(files: readonly CopyFile[]): SortedFiles {
  const kinds = files.map((file) => ({ file, kind: copyFileKind(file.path) }));

  return {
    stories: new Map(kinds.flatMap(({ file, kind }) => (kind.kind === "story" ? [[kind.storyId, file] as const] : []))),
    manifests: new Map(
      kinds.flatMap(({ file, kind }) =>
        kind.kind === "manifest" ? [[kind.storyId, manifestRecords(file.content)] as const] : [],
      ),
    ),
    other: new Map(
      kinds.flatMap(({ file, kind }) => (kind.kind === "other" ? [[file.path, file.content] as const] : [])),
    ),
  };
}

function fileUpdates(base: SortedFiles, current: SortedFiles): (FilePutBody | FileDeleteBody)[] {
  const puts = [...current.other]
    .filter(([path, content]) => base.other.get(path) !== content)
    .map(([path, content]): FilePutBody => ({ type: "file.put", path, content }));
  const deletes = [...base.other.keys()]
    .filter((path) => !current.other.has(path))
    .map((path): FileDeleteBody => ({ type: "file.delete", path }));

  return [...puts, ...deletes];
}

/** Parses a Story file. A file with bad frontmatter gives `undefined`, and the Story gets no update. */
function parseStory(file: CopyFile): MarkdownDocument | undefined {
  try {
    return parseMarkdown(file.content, file.path);
  } catch {
    return undefined;
  }
}

function storyUpdate(fieldKeys: readonly string[], storyId: string, before: CopyFile, after: CopyFile) {
  const old = before.content === after.content ? undefined : parseStory(before);
  const doc = old ? parseStory(after) : undefined;

  if (!(old && doc)) {
    return [];
  }

  const changes = storyChanges(fieldKeys, old, doc);
  const update: StoryUpdateBody = { type: "story.update", storyId, ...storyUidField(doc.data), changes };

  return changes.length > 0 ? [update] : [];
}

function storyUpdates(fieldKeys: readonly string[], base: SortedFiles, current: SortedFiles) {
  const ids = [...current.stories.keys()].toSorted();
  const creates = ids
    .filter((id) => !base.stories.has(id))
    .map((id): StoryCreateBody => {
      const file = current.stories.get(id) as CopyFile;

      return { type: "story.create", storyId: id, path: file.path, content: file.content };
    });
  const updates = ids.flatMap((id) => {
    const before = base.stories.get(id);

    return before ? storyUpdate(fieldKeys, id, before, current.stories.get(id) as CopyFile) : [];
  });
  const deletes = [...base.stories.keys()]
    .toSorted()
    .filter((id) => !current.stories.has(id))
    .map((id): StoryDeleteBody => ({ type: "story.delete", storyId: id }));

  return { creates, updates, deletes };
}

/** The file name of the attachment, when the copy of the Thread has its file. */
function copyFileOf(current: ThreadCopy, storyId: string, id: string): { file?: string } {
  const attachment = current.attachments.find((entry) => entry.storyId === storyId && entry.id === id);

  return attachment ? { file: attachment.file } : {};
}

function storyAttachmentUpdates(
  base: SortedFiles,
  current: SortedFiles,
  copy: ThreadCopy,
  storyId: string,
): (AttachmentAddBody | AttachmentRemoveBody)[] {
  const before = base.manifests.get(storyId) ?? [];
  const after = current.manifests.get(storyId) ?? [];
  const beforeIds = new Set(before.map((record) => record.id));
  const afterIds = new Set(after.map((record) => record.id));
  // A deleted Story leaves the copy with its attachment folder, so its records need no remove.
  const deleted = base.stories.has(storyId) && !current.stories.has(storyId);

  const adds = after
    .filter((record) => !beforeIds.has(record.id))
    .map(
      (attachment): AttachmentAddBody => ({
        type: "attachment.add",
        storyId,
        attachment,
        ...copyFileOf(copy, storyId, attachment.id),
      }),
    );
  const removes = deleted
    ? []
    : before
        .filter((record) => !afterIds.has(record.id))
        .map((record): AttachmentRemoveBody => ({ type: "attachment.remove", storyId, id: record.id }));

  return [...adds, ...removes];
}

function attachmentUpdates(base: SortedFiles, current: SortedFiles, copy: ThreadCopy) {
  const ids = [...new Set([...base.manifests.keys(), ...current.manifests.keys()])].toSorted();

  return ids.flatMap((storyId) => storyAttachmentUpdates(base, current, copy, storyId));
}

/**
 * Gives the inbound updates from the base to the current files, in the order of the apply: the other files first (the
 * config can add a field or a Stage), then the new Stories, the changed Stories, the attachments and the deleted Stories.
 */
export function inboundDiff(input: InboundDiffInput): InboundBody[] {
  if (isDeepStrictEqual(input.base.files, input.current.files)) {
    return [];
  }

  const base = sortFiles(input.base.files);
  const current = sortFiles(input.current.files);
  const stories = storyUpdates(input.fieldKeys, base, current);

  return [
    ...fileUpdates(base, current),
    ...stories.creates,
    ...stories.updates,
    ...attachmentUpdates(base, current, input.current),
    ...stories.deletes,
  ];
}
