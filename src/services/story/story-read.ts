import { basename } from "node:path";
import { attachmentDir, readAttachments } from "../attachment-files/attachment-files.js";
import {
  type CustomField,
  type Issue,
  type ProjectConfig,
  readConfig,
  type StageConfig,
  throwIfIssues,
} from "../config/config.js";
import { NotFoundError } from "../errors/errors.js";
import { type FieldValue, fieldValueError } from "../fields/fields.js";
import { lookupStage, unknownStageIssues } from "../stage/stage.js";
import {
  formatStoryId,
  readStoryFile,
  readStoryFiles,
  type StoryFile,
  sortStoryFiles,
  storyPath,
} from "../story-files/story-files.js";
import { findProject, type ProjectPaths, type ServiceContext } from "../workspace/workspace.js";
import { fieldUpdates } from "./story-input.js";
import type { SearchStoriesInput, Story } from "./story-types.js";

const INVALID_STORY_HINT = "Run `rowbly doctor` to find and fix problems in story files.";

function fieldIssues(field: CustomField, data: Record<string, unknown>): Issue[] {
  const error = fieldValueError(field, data[field.key] ?? null);

  return error ? [{ path: [field.key], message: error }] : [];
}

function storyFileIssues(config: ProjectConfig, data: Record<string, unknown>): Issue[] {
  const title =
    typeof data.title !== "string" || data.title.trim() === ""
      ? [{ path: ["title"], message: "Title is required" }]
      : [];
  const stage =
    typeof data.stage !== "string" || !config.stages.some((s) => s.key === data.stage)
      ? [{ path: ["stage"], message: `Unknown stage "${String(data.stage ?? "")}"` }]
      : [];
  const fields = config.customFields.flatMap((field) => fieldIssues(field, data));

  return [...title, ...stage, ...fields];
}

/** Checks a story file against the config and returns it as a `Story` at `position` in its stage. */
export function toStory(config: ProjectConfig, file: StoryFile, position = 1): Story {
  const { data, body } = file.doc;
  const issues = storyFileIssues(config, data);
  const fields = Object.fromEntries(config.customFields.map((field) => [field.key, data[field.key] ?? null]));

  throwIfIssues(
    `${file.id} is invalid: ${issues.map((issue) => issue.message).join("; ")}`,
    issues,
    INVALID_STORY_HINT,
  );

  return {
    id: file.id,
    number: file.number,
    title: data.title as string,
    stage: data.stage as string,
    position,
    description: body,
    fields: fields as Record<string, FieldValue>,
    path: file.path,
  };
}

/** Accepts `ROW-01`, `row-1` or just `1`. */
function parseStoryId(config: ProjectConfig, id: string): number {
  const match = /^(?:([A-Za-z][A-Za-z0-9]*)-)?(\d+)$/.exec(id.trim());

  if (!match || (match[1] !== undefined && match[1].toUpperCase() !== config.projectKey)) {
    throw new NotFoundError(`Story ${id} not found`, {
      hint: `Story IDs in this project look like ${formatStoryId(config.projectKey, 1)}.`,
    });
  }

  return Number(match[2]);
}

/** The first file of the story with this number, in number order. */
function matchStoryFile(config: ProjectConfig, files: readonly StoryFile[], number: number): StoryFile | undefined {
  return files.find((f) => f.projectKey === config.projectKey && f.number === number);
}

/**
 * Reads the story file at its canonical path. A missing file gives `undefined`, because a story file can have a
 * name that is not canonical, for example `ROW-1.md`.
 */
async function readCanonicalStoryFile(
  paths: ProjectPaths,
  config: ProjectConfig,
  number: number,
): Promise<StoryFile | undefined> {
  const fileName = basename(storyPath(paths, config.projectKey, number));

  try {
    return await readStoryFile(paths, fileName);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return undefined;
    }

    throw error;
  }
}

/** The story file with this number. Reads the canonical path first, and the folder only when that file is missing. */
async function locateStoryFile(
  paths: ProjectPaths,
  config: ProjectConfig,
  number: number,
): Promise<StoryFile | undefined> {
  const canonical = await readCanonicalStoryFile(paths, config, number);

  return canonical ?? matchStoryFile(config, await readStoryFiles(paths), number);
}

/**
 * Finds the file of the story with the ID. With `files`, it searches only that list and reads nothing. Throws a
 * `NotFoundError` when there is none.
 */
export async function findStoryFile(
  paths: ProjectPaths,
  config: ProjectConfig,
  id: string,
  files?: readonly StoryFile[],
): Promise<StoryFile> {
  const number = parseStoryId(config, id);
  const file = files ? matchStoryFile(config, files, number) : await locateStoryFile(paths, config, number);

  if (!file) {
    throw new NotFoundError(`Story ${formatStoryId(config.projectKey, number)} not found`);
  }

  return file;
}

/** The 1-based place of `file` among the stories of its stage. */
export function positionIn(files: readonly StoryFile[], file: StoryFile): number {
  const peers = sortStoryFiles(files.filter((f) => f.doc.data.stage === file.doc.data.stage));

  return peers.findIndex((f) => f.id === file.id) + 1;
}

/** The number of saved images of the story. */
export async function countAttachments(paths: ProjectPaths, id: string): Promise<number> {
  return (await readAttachments(await attachmentDir(paths, id))).length;
}

/** Gives the story with the ID, with its place in its stage and its count of saved images. */
export async function getStory(input: { id: string }, ctx: ServiceContext = {}): Promise<Story> {
  const paths = await findProject(ctx);
  const config = await readConfig(paths);
  const files = await readStoryFiles(paths);
  const file = await findStoryFile(paths, config, input.id, files);
  const story = toStory(config, file, positionIn(files, file));

  return { ...story, attachmentCount: await countAttachments(paths, story.id) };
}

function matchesQuery(story: Story, words: string[], names: string[]): boolean {
  const text = [
    ...names,
    story.id,
    story.title,
    story.description,
    ...Object.values(story.fields).filter((v) => v !== null),
  ]
    .join("\n")
    .toLowerCase();

  return words.every((word) => text.includes(word));
}

/** The place of the stage of `file` in board order. A stage that is not in the config comes last. */
function stageIndex(config: ProjectConfig, file: StoryFile): number {
  const index = config.stages.findIndex((s) => s.key === file.doc.data.stage);

  return index === -1 ? config.stages.length : index;
}

/** The 1-based place of each story in its stage, by story ID. `sorted` is in board order. */
function stagePositions(sorted: readonly StoryFile[]): ReadonlyMap<string, number> {
  const stages = new Set(sorted.map((file) => String(file.doc.data.stage)));

  return new Map(
    [...stages].flatMap((stage) =>
      sorted
        .filter((file) => String(file.doc.data.stage) === stage)
        .map((file, index): [string, number] => [file.id, index + 1]),
    ),
  );
}

/** The story with its count of saved images, and the names of the images for the query. */
async function withAttachmentNames(paths: ProjectPaths, story: Story): Promise<{ story: Story; names: string[] }> {
  const attachments = await readAttachments(await attachmentDir(paths, story.id));

  return { story: { ...story, attachmentCount: attachments.length }, names: attachments.map((a) => a.name) };
}

/** Gives the field filter of a search as values of the field types. Throws when a field or a value is invalid. */
function searchFilter(
  config: ProjectConfig,
  input: SearchStoriesInput,
): { stage: StageConfig | undefined; fields: Record<string, FieldValue> } {
  const stage = input.stage === undefined ? undefined : lookupStage(config, input.stage);
  const stageIssues = input.stage === undefined ? [] : unknownStageIssues(config, input.stage, ["stage"]);
  const fields = fieldUpdates(config, input.fields ?? {});

  throwIfIssues("The search is invalid", [...stageIssues, ...fields.issues]);

  return { stage, fields: fields.values };
}

/** Stories matching every filter given, in board order: by stage, then by position in the stage. With no filters, every story. */
export async function searchStories(input: SearchStoriesInput = {}, ctx: ServiceContext = {}): Promise<Story[]> {
  const paths = await findProject(ctx);
  const config = await readConfig(paths);
  const { stage, fields } = searchFilter(config, input);

  const words = (input.query ?? "").toLowerCase().split(/\s+/).filter(Boolean);
  const files = await readStoryFiles(paths);
  const sorted = sortStoryFiles(files).toSorted((a, b) => stageIndex(config, a) - stageIndex(config, b));
  const positions = stagePositions(sorted);
  const stories = sorted.map((file) => toStory(config, file, positions.get(file.id)));
  const found = await Promise.all(stories.map((story) => withAttachmentNames(paths, story)));

  return found
    .filter(
      ({ story, names }) =>
        (!stage || story.stage === stage.key) &&
        Object.entries(fields).every(([key, value]) => story.fields[key] === value) &&
        matchesQuery(story, words, names),
    )
    .map(({ story }) => story);
}
