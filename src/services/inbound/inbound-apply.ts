// The apply of one inbound update to the copy of a remote Thread on a worker host. A field change is a compare-and-set
// with the same code as the outbox apply. The services run without a recorder, so the apply writes no outbox entry.

import { mkdir, rm } from "node:fs/promises";
import { dirname, join } from "node:path";
import { readCachedAttachment } from "../attachment-cache/attachment-cache.js";
import { attachmentDir, readAttachments, writeAttachments } from "../attachment-files/attachment-files.js";
import { attachmentFileName, isAttachmentFileName } from "../attachment-files/attachment-type.js";
import { NotFoundError, RowblyError, ValidationError } from "../errors/errors.js";
import { writeFileAtomic } from "../files/files.js";
import { decide, updateInput } from "../outbox/outbox-decision.js";
import { recordRef, resolveStoryRef, type Story, updateStory } from "../story/story.js";
import { hasStoryFile, listStoryFileNames } from "../story-files/story-files.js";
import { type ProjectPaths, projectPaths, type ServiceContext } from "../workspace/workspace.js";
import { copyFileKind } from "./inbound-diff.js";
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

/** The copy and the attachment cache of the host. */
export interface InboundTarget {
  /** The copy root. It contains `.rowbly/`. */
  readonly root: string;
  /** The attachment cache of the Project on the host. */
  readonly cache: string;
}

/** The fixed environment of one apply. */
interface CopyEnv {
  readonly target: InboundTarget;
  readonly paths: ProjectPaths;
  /** The context of the services, without a recorder. */
  readonly ctx: ServiceContext;
}

/** The reason of a decision when the value of the copy is not `before` or `after`. The worker value stays. */
const WORKER_VALUE = "The worker changed the value in the copy";

/** Writes a file of the copy with mode 0600. Its folder gets mode 0700. */
async function writeCopyFile(path: string, content: string | Uint8Array): Promise<void> {
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  await writeFileAtomic(path, content, { mode: 0o600 });
}

/** Gives the Story of the update in the copy, or `undefined` when the copy does not have it. */
async function copyStory(env: CopyEnv, update: StoryUpdateBody): Promise<Story | undefined> {
  try {
    return await resolveStoryRef(recordRef(update.storyId, update.storyUid), env.ctx);
  } catch (error) {
    if (error instanceof NotFoundError) {
      return undefined;
    }

    throw error;
  }
}

/** Writes each change whose copy value is `before`. A change of the worker stays. A refused write records nothing. */
async function applyStoryUpdate(env: CopyEnv, update: StoryUpdateBody): Promise<void> {
  const story = await copyStory(env, update);

  if (!story) {
    return;
  }

  const writes = update.changes
    .map((change) => decide(story, change, WORKER_VALUE))
    .filter((decision) => decision.action === "write");

  if (writes.length === 0) {
    return;
  }

  try {
    await updateStory(
      updateInput(
        story.id,
        writes.map((decision) => decision.change),
      ),
      env.ctx,
    );
  } catch (error) {
    if (!(error instanceof RowblyError)) {
      throw error;
    }
  }
}

async function applyStoryCreate(env: CopyEnv, update: StoryCreateBody): Promise<void> {
  const kind = copyFileKind(update.path);

  if (kind.kind !== "story" || kind.storyId !== update.storyId) {
    throw new ValidationError("The path of a new Story must be its Story file", { details: { path: update.path } });
  }

  if (await hasStoryFile(env.paths, update.storyId)) {
    return;
  }

  await writeCopyFile(join(env.target.root, update.path), update.content);
}

async function applyStoryDelete(env: CopyEnv, update: StoryDeleteBody): Promise<void> {
  const names = await listStoryFileNames(env.paths);
  const files = names.filter((name) => name.id === update.storyId);

  await Promise.all(files.map((name) => rm(name.path, { force: true })));
  await rm(await attachmentDir(env.paths, update.storyId), { recursive: true, force: true });
}

/** Writes the file of a new attachment from the cache of the host. A file that the cache does not have is skipped. */
async function writeAttachmentFile(env: CopyEnv, dir: string, update: AttachmentAddBody): Promise<void> {
  const { file } = update;

  if (file === undefined) {
    return;
  }

  if (!isAttachmentFileName(update.attachment.id, file)) {
    throw new ValidationError("The file of an attachment must be its id with one safe extension", {
      details: { file },
    });
  }

  try {
    const bytes = await readCachedAttachment({ dir: env.target.cache, id: update.attachment.id });

    await writeCopyFile(join(dir, file), bytes);
  } catch (error) {
    if (!(error instanceof NotFoundError)) {
      throw error;
    }
  }
}

async function applyAttachmentAdd(env: CopyEnv, update: AttachmentAddBody): Promise<void> {
  const dir = await attachmentDir(env.paths, update.storyId);
  const records = await readAttachments(dir);

  if (records.some((record) => record.id === update.attachment.id)) {
    return;
  }

  await writeAttachmentFile(env, dir, update);
  await writeAttachments(dir, [...records, update.attachment]);
}

async function applyAttachmentRemove(env: CopyEnv, update: AttachmentRemoveBody): Promise<void> {
  const dir = await attachmentDir(env.paths, update.storyId);
  const records = await readAttachments(dir);
  const record = records.find((entry) => entry.id === update.id);

  if (!record) {
    return;
  }

  await writeAttachments(
    dir,
    records.filter((entry) => entry.id !== update.id),
  );
  await rm(join(dir, attachmentFileName(record)), { force: true });
}

async function applyFile(env: CopyEnv, update: FilePutBody | FileDeleteBody): Promise<void> {
  const path = join(env.target.root, update.path);

  if (update.type === "file.put") {
    await writeCopyFile(path, update.content);
    return;
  }

  await rm(path, { force: true });
}

/** The apply function of each update type. */
const APPLY: { readonly [K in InboundBody["type"]]: (env: CopyEnv, update: never) => Promise<void> } = {
  "story.update": applyStoryUpdate,
  "story.create": applyStoryCreate,
  "story.delete": applyStoryDelete,
  "attachment.add": applyAttachmentAdd,
  "attachment.remove": applyAttachmentRemove,
  "file.put": applyFile,
  "file.delete": applyFile,
};

/**
 * Applies one inbound update to the copy. The caller checked the update and holds the Thread write lock. An update
 * that is already in the copy, or whose Story is not there, has no effect.
 */
export async function applyInboundUpdate(target: InboundTarget, update: InboundBody): Promise<void> {
  const env: CopyEnv = { target, paths: projectPaths(target.root), ctx: { cwd: target.root } };
  const apply = APPLY[update.type] as (env: CopyEnv, update: InboundBody) => Promise<void>;

  await apply(env, update);
}
