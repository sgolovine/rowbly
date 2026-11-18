import { randomUUID } from "node:crypto";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { isDeepStrictEqual } from "node:util";
import { attachmentDir, prepareImages, withAttachments } from "../attachment-files/attachment-files.js";
import { type ProjectConfig, readConfig, throwIfIssues } from "../config/config.js";
import { ValidationError } from "../errors/errors.js";
import { mapInOrder } from "../in-order/in-order.js";
import type { MarkdownDocument } from "../markdown/markdown.js";
import { recordStoryWrite, refuseRemoteWrite, storyChanges } from "../outbox/outbox.js";
import { rewriteSpecLinks } from "../spec-files/spec-files.js";
import { lookupStage, unknownStageIssues } from "../stage/stage.js";
import {
  dependsOnOf,
  formatStoryId,
  readStoryFiles,
  removeStoryFile,
  type StoryFile,
  saveStoryFile,
  storyHomePath,
  withDependsOn,
  withTags,
  withUpdatedAt,
  writeStoryFile,
} from "../story-files/story-files.js";
import { findProject, type ProjectPaths, type ServiceContext } from "../workspace/workspace.js";
import { changedDependsOn, checkedDependsOn, removeDependencies } from "./story-dependencies.js";
import { fieldUpdates, titleIssues } from "./story-input.js";
import { countAttachments, findStoryFile, getStory, positionIn, toStory } from "./story-read.js";
import { storyUidField } from "./story-ref.js";
import { checkedTags, updatedTags } from "./story-tags.js";
import type { CreateStoryInput, DeleteStoryResult, Story, UpdateStoryInput } from "./story-types.js";

export {
  type StoryRead,
  withoutStory,
  withoutStoryAt,
  withStory,
  withStoryInOrder,
  withStoryReads,
} from "./story-order.js";
export {
  getStory,
  getStoryDetails,
  listStoryRefs,
  readStoryAt,
  resolveStoryRef,
  searchStories,
} from "./story-read.js";
export { matchStoryRef, recordRef, refersToStory, type StoryRef, storyUidField } from "./story-ref.js";
export * from "./story-types.js";

/** The bytes of a story file before an update, so that a failed save of the images can restore it. */
interface Snapshot {
  readonly path: string;
  readonly bytes: Buffer;
}

/** The current time of the service, which a test can set. */
function nowOf(ctx: ServiceContext): Date {
  return ctx.now?.() ?? new Date();
}

/** The frontmatter of a new story, created at `now`. Throws a `ValidationError` when the input is invalid. */
function newStoryData(config: ProjectConfig, input: CreateStoryInput, now: Date): Record<string, unknown> {
  const stage =
    input.stage === undefined
      ? (config.stages.find((s) => s.enabled) ?? config.stages[0])
      : lookupStage(config, input.stage);
  const stageIssues = input.stage === undefined ? [] : unknownStageIssues(config, input.stage, ["stage"]);
  const fields = fieldUpdates(config, input.fields ?? {});
  const empty = Object.fromEntries(config.customFields.map((field) => [field.key, null]));

  throwIfIssues("The story is invalid", [...stageIssues, ...titleIssues(input.title), ...fields.issues]);

  const time = now.toISOString();
  const data = { title: input.title.trim(), stage: stage?.key, uid: randomUUID(), createdAt: time, updatedAt: time };

  return { ...withTags(data, checkedTags(config, input.tags ?? [], ["tags"])), ...empty, ...fields.values };
}

/** Writes the file of a new story. A failure removes the file, so that no half story stays. */
async function writeNewStory(
  paths: ProjectPaths,
  config: ProjectConfig,
  path: string,
  doc: MarkdownDocument,
  number: number,
  ctx: ServiceContext,
): Promise<Story> {
  try {
    await writeStoryFile(config, path, doc);

    return await getStory({ id: String(number) }, ctx);
  } catch (err) {
    await removeStoryFile(paths, path);
    throw err;
  }
}

/** Creates a story with the next free number, in the given stage or the first enabled stage. */
export async function createStory(input: CreateStoryInput, ctx: ServiceContext = {}): Promise<Story> {
  refuseRemoteWrite(ctx, "create a Story");

  const images = prepareImages(input.attachments ?? [], true);
  const now = nowOf(ctx);
  const paths = await findProject(ctx);
  const config = await readConfig(paths);
  const data = newStoryData(config, input, now);

  const files = await readStoryFiles(paths);
  const number = Math.max(0, ...files.map((file) => file.number)) + 1;
  const path = storyHomePath(
    paths,
    config,
    join(paths.storiesDir, `${formatStoryId(config.projectKey, number)}.md`),
    data,
  );
  const dependsOn = checkedDependsOn(config, files, formatStoryId(config.projectKey, number), input.dependsOn ?? []);
  const doc = { data: withDependsOn(data, dependsOn), body: input.description ?? "" };

  return withAttachments(
    await attachmentDir(paths, formatStoryId(config.projectKey, number)),
    images,
    now,
    () => writeNewStory(paths, config, path, doc, number, ctx),
    storyUidField(data),
  );
}

/**
 * The new `dependsOn` list of the update, or `undefined` when the list does not change. Throws a `ValidationError`
 * when the input has a full list together with an addition or a removal.
 */
function requestedDependsOn(
  config: ProjectConfig,
  file: StoryFile,
  input: UpdateStoryInput,
): readonly string[] | undefined {
  const { dependsOn, addDependsOn, removeDependsOn } = input;

  if (addDependsOn === undefined && removeDependsOn === undefined) {
    return dependsOn;
  }

  if (dependsOn !== undefined) {
    throw new ValidationError("Give a full dependsOn list or the changes to the list, not both", {
      details: {
        issues: [{ path: ["dependsOn"], message: "dependsOn cannot be used with addDependsOn or removeDependsOn" }],
      },
    });
  }

  const current = dependsOnOf(file.doc.data);
  const changed = changedDependsOn(config, current, addDependsOn ?? [], removeDependsOn ?? []);

  // An addition of an ID in the list, or a removal of a missing ID, does not write or validate the list.
  return changed.join("\n") === current.join("\n") ? undefined : changed;
}

/** The frontmatter after an update of the `dependsOn` list. Without a change of the list, the old value stays. */
function updatedDependsOn(
  config: ProjectConfig,
  files: readonly StoryFile[],
  file: StoryFile,
  data: Record<string, unknown>,
  input: UpdateStoryInput,
): Record<string, unknown> {
  const dependsOn = requestedDependsOn(config, file, input);

  return dependsOn === undefined ? data : withDependsOn(data, checkedDependsOn(config, files, file.id, dependsOn));
}

/** The frontmatter of the story after the update. Throws a `ValidationError` when the input is invalid. */
function updatedStoryData(
  config: ProjectConfig,
  files: readonly StoryFile[],
  file: StoryFile,
  input: UpdateStoryInput,
): Record<string, unknown> {
  const stage = input.stage === undefined ? undefined : lookupStage(config, input.stage);
  const fields = fieldUpdates(config, input.fields ?? {});

  throwIfIssues("The story is invalid", [
    ...(input.title === undefined ? [] : titleIssues(input.title)),
    ...(input.stage === undefined ? [] : unknownStageIssues(config, input.stage, ["stage"])),
    ...fields.issues,
  ]);

  const data = {
    ...file.doc.data,
    ...(input.title === undefined ? {} : { title: input.title.trim() }),
    ...(input.stage === undefined ? {} : { stage: stage?.key }),
    ...fields.values,
  };

  return updatedTags(config, updatedDependsOn(config, files, file, data, input), input);
}

/** The story file with `updatedAt` set to `now`. */
function stamped(file: StoryFile, now: Date): StoryFile {
  return { ...file, doc: { ...file.doc, data: withUpdatedAt(file.doc.data, now) } };
}

/** Whether the new frontmatter or body differs from the story file. */
function changesStory(file: StoryFile, doc: MarkdownDocument): boolean {
  return doc.body !== file.doc.body || !isDeepStrictEqual(doc.data, file.doc.data);
}

/**
 * Writes the update. The story gets a new `updatedAt` when the update changes it, or when `touched` is true, for
 * example because the update adds images.
 */
async function updateStoryFields(input: UpdateStoryInput, ctx: ServiceContext, touched: boolean): Promise<Story> {
  const paths = await findProject(ctx);
  const config = await readConfig(paths);
  const files = await readStoryFiles(paths);
  const file = await findStoryFile(paths, config, input.id, files);
  const data = updatedStoryData(config, files, file, input);

  const updated = { ...file, doc: { data, body: input.description ?? file.doc.body } };
  const written = touched || changesStory(file, updated.doc) ? stamped(updated, nowOf(ctx)) : updated;

  // Checked before writing, so an update never leaves a story invalid.
  toStory(config, updated);

  const path = await saveStoryFile(paths, config, file.path, written.doc);
  const placed = { ...written, path };
  const fieldKeys = config.customFields.map((field) => field.key);

  // The entry follows the Story write, so that a failed write records no change.
  await recordStoryWrite(ctx, {
    storyId: file.id,
    ...storyUidField(file.doc.data),
    changes: storyChanges(fieldKeys, file.doc, updated.doc),
  });

  return toStory(config, placed, positionIn([...files.filter((f) => f.id !== file.id), placed], placed));
}

async function updateWithoutImages(input: UpdateStoryInput, ctx: ServiceContext): Promise<Story> {
  const story = await updateStoryFields(input, ctx, false);

  return { ...story, attachmentCount: await countAttachments(await findProject(ctx), story.id) };
}

/** The story file that an update writes. The update does not write the other stories. */
async function snapshotStories(paths: ProjectPaths, story: Story): Promise<Snapshot[]> {
  const before = (await readStoryFiles(paths)).filter((file) => file.id === story.id);

  return Promise.all(before.map(async (file) => ({ path: file.path, bytes: await readFile(file.path) })));
}

/** The bytes of the file, or `undefined` when the file is missing, for example after a move to a new Stage folder. */
async function readIfPresent(path: string): Promise<Buffer | undefined> {
  try {
    return await readFile(path);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return undefined;
    }

    throw error;
  }
}

async function restoreSnapshot(snapshot: Snapshot): Promise<void> {
  const current = await readIfPresent(snapshot.path);

  if (!current?.equals(snapshot.bytes)) {
    await mkdir(dirname(snapshot.path), { recursive: true });
    await writeFile(snapshot.path, snapshot.bytes);
  }
}

/** Removes the copy of a story file that a failed update wrote in a new Stage folder. */
async function removeMovedCopies(paths: ProjectPaths, snapshots: readonly Snapshot[]): Promise<void> {
  const before = new Set(snapshots.map((snapshot) => snapshot.path));
  const files = await readStoryFiles(paths);
  const ids = new Set(files.filter((file) => before.has(file.path)).map((file) => file.id));
  const copies = files.filter((file) => ids.has(file.id) && !before.has(file.path));

  await mapInOrder(copies, (file) => removeStoryFile(paths, file.path));
}

/** Updates the story. A failure puts back each story file that the update changed. */
async function updateOrRestore(
  paths: ProjectPaths,
  input: UpdateStoryInput,
  ctx: ServiceContext,
  snapshots: readonly Snapshot[],
): Promise<Story> {
  try {
    await updateStoryFields(input, ctx, true);

    return await getStory({ id: input.id }, ctx);
  } catch (err) {
    await mapInOrder(snapshots, (snapshot) => restoreSnapshot(snapshot));
    await removeMovedCopies(paths, snapshots);
    throw err;
  }
}

/** Changes a story. A story that changes goes to the top of its stage, because the stage order is by `updatedAt`. */
export async function updateStory(input: UpdateStoryInput, ctx: ServiceContext = {}): Promise<Story> {
  if (input.attachments?.length) {
    refuseRemoteWrite(ctx, "add an attachment");
  }

  const images = prepareImages(input.attachments ?? [], true);

  if (!images.length) {
    return updateWithoutImages(input, ctx);
  }

  const paths = await findProject(ctx);
  const story = await getStory({ id: input.id }, ctx);
  const snapshots = await snapshotStories(paths, story);

  return withAttachments(
    await attachmentDir(paths, story.id),
    images,
    nowOf(ctx),
    () => updateOrRestore(paths, input, ctx, snapshots),
    storyUidField(story),
  );
}

/** Sets the `updatedAt` of the story to the current time, for a change outside the story file, such as an image. */
export async function touchStory(input: { id: string }, ctx: ServiceContext = {}): Promise<void> {
  const paths = await findProject(ctx);
  const config = await readConfig(paths);
  const file = await findStoryFile(paths, config, input.id);

  await saveStoryFile(paths, config, file.path, file.doc, nowOf(ctx));
}

/**
 * Deletes a story, its images and its links from the specs. Removes its ID from the `dependsOn` list of each
 * downstream story, and gives a warning for each changed story.
 */
export async function deleteStory(input: { id: string }, ctx: ServiceContext = {}): Promise<DeleteStoryResult> {
  refuseRemoteWrite(ctx, "delete a Story");

  const paths = await findProject(ctx);
  const config = await readConfig(paths);
  const files = await readStoryFiles(paths);
  const file = await findStoryFile(paths, config, input.id, files);

  const warnings = await removeDependencies(config, files, file.id, nowOf(ctx));

  await rm(await attachmentDir(paths, file.id), { recursive: true, force: true });
  await removeStoryFile(paths, file.path);
  // A spec that loses its last Story stays, and `doctor` reports it as an orphan.
  await rewriteSpecLinks(paths, (stories) => stories.filter((id) => id !== file.id));

  return { id: file.id, warnings };
}
