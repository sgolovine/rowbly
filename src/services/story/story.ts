import { readFile, rm, writeFile } from "node:fs/promises";
import { attachmentDir, prepareImages, withAttachments } from "../attachment-files/attachment-files.js";
import { type ProjectConfig, readConfig, throwIfIssues } from "../config/config.js";
import { mapInOrder } from "../in-order/in-order.js";
import type { MarkdownDocument } from "../markdown/markdown.js";
import { rewriteSpecLinks } from "../spec-files/spec-files.js";
import { lookupStage, unknownStageIssues } from "../stage/stage.js";
import {
  formatStoryId,
  readStoryFiles,
  type StoryFile,
  sortStoryFiles,
  storyPath,
  writeStoryFile,
} from "../story-files/story-files.js";
import { findProject, type ProjectPaths, type ServiceContext } from "../workspace/workspace.js";
import { fieldUpdates, positionIssues, titleIssues } from "./story-input.js";
import { countAttachments, findStoryFile, getStory, positionIn, toStory } from "./story-read.js";
import type { CreateStoryInput, Story, UpdateStoryInput } from "./story-types.js";

export { getStory, searchStories } from "./story-read.js";
export * from "./story-types.js";

/** The bytes of a story file before an update, so that a failed save of the images can restore it. */
interface Snapshot {
  readonly path: string;
  readonly bytes: Buffer;
}

/** The frontmatter of a new story. Throws a `ValidationError` when the input is invalid. */
function newStoryData(config: ProjectConfig, input: CreateStoryInput): Record<string, unknown> {
  const stage =
    input.stage === undefined
      ? (config.stages.find((s) => s.enabled) ?? config.stages[0])
      : lookupStage(config, input.stage);
  const stageIssues = input.stage === undefined ? [] : unknownStageIssues(config, input.stage, ["stage"]);
  const fields = fieldUpdates(config, input.fields ?? {});
  const empty = Object.fromEntries(config.customFields.map((field) => [field.key, null]));

  throwIfIssues("The story is invalid", [...stageIssues, ...titleIssues(input.title), ...fields.issues]);

  return { title: input.title.trim(), stage: stage?.key, ...empty, ...fields.values };
}

/** Writes the file of a new story. A failure removes the file, so that no half story stays. */
async function writeNewStory(
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
    await rm(path, { force: true });
    throw err;
  }
}

/** Creates a story with the next free number, in the given stage or the first enabled stage. */
export async function createStory(input: CreateStoryInput, ctx: ServiceContext = {}): Promise<Story> {
  const images = prepareImages(input.attachments ?? [], true);
  const paths = await findProject(ctx);
  const config = await readConfig(paths);
  const data = newStoryData(config, input);

  const files = await readStoryFiles(paths);
  const number = Math.max(0, ...files.map((file) => file.number)) + 1;
  const path = storyPath(paths, config.projectKey, number);
  const doc = { data, body: input.description ?? "" };

  return withAttachments(
    await attachmentDir(paths, formatStoryId(config.projectKey, number)),
    images,
    ctx.now?.() ?? new Date(),
    () => writeNewStory(config, path, doc, number, ctx),
  );
}

/** The frontmatter of the story after the update. Throws a `ValidationError` when the input is invalid. */
function updatedStoryData(config: ProjectConfig, file: StoryFile, input: UpdateStoryInput): Record<string, unknown> {
  const stage = input.stage === undefined ? undefined : lookupStage(config, input.stage);
  const fields = fieldUpdates(config, input.fields ?? {});

  throwIfIssues("The story is invalid", [
    ...(input.title === undefined ? [] : titleIssues(input.title)),
    ...(input.stage === undefined ? [] : unknownStageIssues(config, input.stage, ["stage"])),
    ...positionIssues(input.position),
    ...fields.issues,
  ]);

  return {
    ...file.doc.data,
    ...(input.title === undefined ? {} : { title: input.title.trim() }),
    ...(input.stage === undefined ? {} : { stage: stage?.key }),
    ...fields.values,
  };
}

/** Writes the story at `position` in its stage. The moved story is always written. */
async function writePosition(config: ProjectConfig, file: StoryFile, position: number, moved: boolean): Promise<void> {
  if (!moved && file.doc.data.position === position) {
    return;
  }

  await writeStoryFile(config, file.path, { ...file.doc, data: { ...file.doc.data, position } });
}

/** Puts the story at its new place in its stage. The other stories keep their order; each one that moves is rewritten. */
async function placeStory(
  config: ProjectConfig,
  files: readonly StoryFile[],
  updated: StoryFile,
  position: number | undefined,
): Promise<Story> {
  const peers = sortStoryFiles(files.filter((f) => f.id !== updated.id && f.doc.data.stage === updated.doc.data.stage));
  const at = Math.max(0, Math.min(peers.length, (position ?? peers.length + 1) - 1));
  const order = [...peers.slice(0, at), updated, ...peers.slice(at)];

  await mapInOrder(order, (f, i) => writePosition(config, f, i + 1, f.id === updated.id));

  return toStory(config, updated, at + 1);
}

async function updateStoryFields(input: UpdateStoryInput, ctx: ServiceContext): Promise<Story> {
  const paths = await findProject(ctx);
  const config = await readConfig(paths);
  const file = await findStoryFile(paths, config, input.id);
  const data = updatedStoryData(config, file, input);

  const moved = data.stage !== file.doc.data.stage;
  const updated = { ...file, doc: { data, body: input.description ?? file.doc.body } };
  const files = await readStoryFiles(paths);

  // Checked before writing, so an update never leaves a story invalid.
  toStory(config, updated);

  if (input.position === undefined && !moved) {
    await writeStoryFile(config, file.path, updated.doc);

    return toStory(config, updated, positionIn(files, file));
  }

  return placeStory(config, files, updated, input.position);
}

async function updateWithoutImages(input: UpdateStoryInput, ctx: ServiceContext): Promise<Story> {
  const story = await updateStoryFields(input, ctx);

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

async function restoreSnapshot(snapshot: Snapshot): Promise<void> {
  const current = await readFile(snapshot.path);

  if (!current.equals(snapshot.bytes)) {
    await writeFile(snapshot.path, snapshot.bytes);
  }
}

/** Updates the story. A failure puts back each story file that the update changed. */
async function updateOrRestore(
  input: UpdateStoryInput,
  ctx: ServiceContext,
  snapshots: readonly Snapshot[],
): Promise<Story> {
  try {
    await updateStoryFields(input, ctx);

    return await getStory({ id: input.id }, ctx);
  } catch (err) {
    await mapInOrder(snapshots, (snapshot) => restoreSnapshot(snapshot));
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

  return withAttachments(await attachmentDir(paths, story.id), images, ctx.now?.() ?? new Date(), () =>
    updateOrRestore(input, ctx, snapshots),
  );
}

/** Deletes a story, its images and its links from the specs. */
export async function deleteStory(input: { id: string }, ctx: ServiceContext = {}): Promise<{ id: string }> {
  const paths = await findProject(ctx);
  const config = await readConfig(paths);
  const file = await findStoryFile(paths, config, input.id);

  await rm(await attachmentDir(paths, file.id), { recursive: true, force: true });
  await rm(file.path);
  // A spec that loses its last Story stays, and `doctor` reports it as an orphan.
  await rewriteSpecLinks(paths, (stories) => stories.filter((id) => id !== file.id));

  return { id: file.id };
}
