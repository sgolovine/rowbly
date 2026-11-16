import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { isDeepStrictEqual } from "node:util";
import { attachmentDir, prepareImages, withAttachments } from "../attachment-files/attachment-files.js";
import { type ProjectConfig, readConfig, throwIfIssues } from "../config/config.js";
import { ValidationError } from "../errors/errors.js";
import { mapInOrder } from "../in-order/in-order.js";
import type { MarkdownDocument } from "../markdown/markdown.js";
import { rewriteSpecLinks } from "../spec-files/spec-files.js";
import { lookupStage, unknownStageIssues } from "../stage/stage.js";
import {
  dependsOnOf,
  formatStoryId,
  readStoryFiles,
  removeStoryFile,
  type StoryFile,
  saveStoryFile,
  sortStoryFiles,
  storyHomePath,
  withDependsOn,
  withTags,
  withUpdatedAt,
  writeStoryFile,
} from "../story-files/story-files.js";
import { findProject, type ProjectPaths, type ServiceContext } from "../workspace/workspace.js";
import { changedDependsOn, checkedDependsOn, removeDependencies } from "./story-dependencies.js";
import { fieldUpdates, positionIssues, titleIssues } from "./story-input.js";
import { countAttachments, findStoryFile, getStory, positionIn, toStory } from "./story-read.js";
import { checkedTags, updatedTags } from "./story-tags.js";
import type { CreateStoryInput, DeleteStoryResult, Story, UpdateStoryInput } from "./story-types.js";

export { getStory, getStoryDetails, searchStories } from "./story-read.js";
export * from "./story-types.js";

/** The bytes of a story file before an update, so that a failed save of the images can restore it. */
interface Snapshot {
  readonly path: string;
  readonly bytes: Buffer;
}

/** The time of an update, and whether the update changes the story. */
interface StoryChange {
  readonly now: Date;
  /** Whether the update changes the story itself, not only its place in the stage. */
  readonly changed: boolean;
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
  const data = { title: input.title.trim(), stage: stage?.key, createdAt: time, updatedAt: time };

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

  return withAttachments(await attachmentDir(paths, formatStoryId(config.projectKey, number)), images, now, () =>
    writeNewStory(paths, config, path, doc, number, ctx),
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
    ...positionIssues(input.position),
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

/**
 * Writes the story at `position` in its stage, and gives the path of its file. The moved story is always written. A
 * peer that gets a new `position` keeps its `updatedAt`, because the peer itself did not change.
 */
async function writePosition(
  paths: ProjectPaths,
  config: ProjectConfig,
  file: StoryFile,
  position: number,
  moved: boolean,
): Promise<string> {
  if (!moved && file.doc.data.position === position) {
    return file.path;
  }

  return saveStoryFile(paths, config, file.path, { ...file.doc, data: { ...file.doc.data, position } });
}

/** The story file with `updatedAt` set to `now`. */
function stamped(file: StoryFile, now: Date): StoryFile {
  return { ...file, doc: { ...file.doc, data: withUpdatedAt(file.doc.data, now) } };
}

/** Puts the story at its new place in its stage. The other stories keep their order; each one that moves is rewritten. */
async function placeStory(
  paths: ProjectPaths,
  config: ProjectConfig,
  files: readonly StoryFile[],
  updated: StoryFile,
  position: number | undefined,
  change: StoryChange,
): Promise<Story> {
  const peers = sortStoryFiles(files.filter((f) => f.id !== updated.id && f.doc.data.stage === updated.doc.data.stage));
  const at = Math.max(0, Math.min(peers.length, (position ?? peers.length + 1) - 1));
  // A new place is a change of the moved story, also when nothing else of it changes.
  const placed = change.changed || updated.doc.data.position !== at + 1 ? stamped(updated, change.now) : updated;
  const order = [...peers.slice(0, at), placed, ...peers.slice(at)];

  const written = await mapInOrder(order, (f, i) => writePosition(paths, config, f, i + 1, f.id === placed.id));

  return toStory(config, { ...placed, path: written[at] ?? placed.path }, at + 1);
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

  const moved = data.stage !== file.doc.data.stage;
  const updated = { ...file, doc: { data, body: input.description ?? file.doc.body } };

  const change: StoryChange = { now: nowOf(ctx), changed: touched || changesStory(file, updated.doc) };

  // Checked before writing, so an update never leaves a story invalid.
  toStory(config, updated);

  if (input.position === undefined && !moved) {
    const written = change.changed ? stamped(updated, change.now) : updated;

    const path = await saveStoryFile(paths, config, file.path, written.doc);

    return toStory(config, { ...written, path }, positionIn(files, file));
  }

  return placeStory(paths, config, files, updated, input.position, change);
}

async function updateWithoutImages(input: UpdateStoryInput, ctx: ServiceContext): Promise<Story> {
  const story = await updateStoryFields(input, ctx, false);

  return { ...story, attachmentCount: await countAttachments(await findProject(ctx), story.id) };
}

/** The story files that an update can write: the story, and the stories of its stage when it changes place. */
async function snapshotStories(paths: ProjectPaths, story: Story, input: UpdateStoryInput): Promise<Snapshot[]> {
  const destination = (input.stage ?? story.stage).trim().toUpperCase();
  const reordered = destination !== story.stage || input.position !== undefined;
  const before = (await readStoryFiles(paths)).filter(
    (file) => file.id === story.id || (reordered && file.doc.data.stage === destination),
  );

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

/** Changes a story. A new stage or position also rewrites the positions of the stories in the stage. */
export async function updateStory(input: UpdateStoryInput, ctx: ServiceContext = {}): Promise<Story> {
  const images = prepareImages(input.attachments ?? [], true);

  if (!images.length) {
    return updateWithoutImages(input, ctx);
  }

  const paths = await findProject(ctx);
  const story = await getStory({ id: input.id }, ctx);
  const snapshots = await snapshotStories(paths, story, input);

  return withAttachments(await attachmentDir(paths, story.id), images, nowOf(ctx), () =>
    updateOrRestore(paths, input, ctx, snapshots),
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
