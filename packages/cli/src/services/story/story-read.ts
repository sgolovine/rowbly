import { attachmentDir, attachmentOwners, readAttachments } from "../attachment-files/attachment-files.js";
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
  blocksOf,
  type DependencyIndex,
  dependencyIndex,
  indexedIsBlocked,
  waitingFor,
} from "../story-dependency/story-dependency.js";
import {
  dependsOnOf,
  formatStoryId,
  listStoryFileNames,
  readStoryFile,
  readStoryFiles,
  type StoryFile,
  type StoryFileName,
  sortStoryFiles,
  storyTimeOf,
  tagsOf,
} from "../story-files/story-files.js";
import { findProject, type ProjectPaths, type ServiceContext } from "../workspace/workspace.js";
import { dependencyStories } from "./story-dependencies.js";
import { fieldUpdates } from "./story-input.js";
import { matchStoryRef, recordRef, type StoryRef } from "./story-ref.js";
import { checkedTags } from "./story-tags.js";
import type { SearchStoriesInput, Story, StoryDetails } from "./story-types.js";

/** The reference of a story file, with the file. */
interface StoryFileRef extends StoryRef {
  readonly file: StoryFile;
}

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

/** The `branch` key of the frontmatter, when it is a string that is not empty. */
function branchOf(data: Record<string, unknown>): { branch?: string } {
  return typeof data.branch === "string" && data.branch.trim() !== "" ? { branch: data.branch.trim() } : {};
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
    ...(typeof data.uid === "string" ? { uid: data.uid } : {}),
    title: data.title as string,
    stage: data.stage as string,
    position,
    dependsOn: dependsOnOf(data),
    tags: tagsOf(data),
    createdAt: storyTimeOf(data, "createdAt"),
    updatedAt: storyTimeOf(data, "updatedAt"),
    description: body,
    ...branchOf(data),
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
 * The name of the story file with this number. The canonical name (`ROW-01.md`) comes first, because a story file
 * can also have a name that is not canonical, for example `ROW-1.md`.
 */
function matchStoryFileName(
  config: ProjectConfig,
  names: readonly StoryFileName[],
  number: number,
): StoryFileName | undefined {
  const id = formatStoryId(config.projectKey, number);
  const matches = names.filter((name) => name.projectKey === config.projectKey && name.number === number);

  return matches.find((name) => name.id === id) ?? matches[0];
}

/** The story file with this number. It lists the Stage folders and reads only the file of the story. */
async function locateStoryFile(
  paths: ProjectPaths,
  config: ProjectConfig,
  number: number,
): Promise<StoryFile | undefined> {
  const name = matchStoryFileName(config, await listStoryFileNames(paths), number);

  return name ? readStoryFile(name.path) : undefined;
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

/** Gives the story of the file, with its place in its stage and its count of saved images. */
async function storyOf(
  paths: ProjectPaths,
  config: ProjectConfig,
  files: readonly StoryFile[],
  file: StoryFile,
): Promise<Story> {
  const story = toStory(config, file, positionIn(files, file));

  return { ...story, attachmentCount: await countAttachments(paths, story.id) };
}

/** Gives the story with the ID, with its place in its stage and its count of saved images. */
export async function getStory(input: { id: string }, ctx: ServiceContext = {}): Promise<Story> {
  const paths = await findProject(ctx);
  const config = await readConfig(paths);
  const files = await readStoryFiles(paths);
  const file = await findStoryFile(paths, config, input.id, files);

  return storyOf(paths, config, files, file);
}

/** The `uid` of the story file, or `undefined` when the file has none. */
function fileUid(file: StoryFile): string | undefined {
  return typeof file.doc.data.uid === "string" ? file.doc.data.uid : undefined;
}

/** The reference of each story file: its ID and its `uid`. */
function fileRefs(files: readonly StoryFile[]): StoryFileRef[] {
  return files.map((file) => ({ ...recordRef(file.id, fileUid(file)), file }));
}

/**
 * Gives the story of a record: the story with the `uid` of the reference first, then the story with its ID. See
 * `matchStoryRef`. Throws a `NotFoundError` when no story matches.
 */
export async function resolveStoryRef(ref: StoryRef, ctx: ServiceContext = {}): Promise<Story> {
  const paths = await findProject(ctx);
  const config = await readConfig(paths);
  const files = await readStoryFiles(paths);
  // `findStoryFile` also accepts a short ID, for example `1`, and gives the `NotFoundError`.
  const file = matchStoryRef(fileRefs(files), ref)?.file ?? (await findStoryFile(paths, config, ref.id, files));

  return storyOf(paths, config, files, file);
}

/** Gives the ID and the `uid` of each story, for a match with `matchStoryRef`. It does not check the stories. */
export async function listStoryRefs(ctx: ServiceContext = {}): Promise<StoryRef[]> {
  const files = await readStoryFiles(await findProject(ctx));

  return fileRefs(files).map(({ id, uid }) => recordRef(id, uid));
}

/** Gives the story with the ID, with its downstream Stories and the upstream Stories that are not complete. */
export async function getStoryDetails(input: { id: string }, ctx: ServiceContext = {}): Promise<StoryDetails> {
  const paths = await findProject(ctx);
  const config = await readConfig(paths);
  const files = await readStoryFiles(paths);
  const file = await findStoryFile(paths, config, input.id, files);

  const story = toStory(config, file, positionIn(files, file));
  const dependencies = dependencyStories(files);

  return {
    ...story,
    attachmentCount: await countAttachments(paths, story.id),
    blocks: blocksOf(dependencies, story.id),
    waitingFor: waitingFor(dependencies, config.stages, story.id),
  };
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

/**
 * The story with its count of saved images, and the names of the images for the query. A story without a folder in
 * `owners` reads no manifest.
 */
async function withAttachmentNames(
  paths: ProjectPaths,
  owners: ReadonlySet<string>,
  story: Story,
): Promise<{ story: Story; names: string[] }> {
  if (!owners.has(story.id)) {
    return { story: { ...story, attachmentCount: 0 }, names: [] };
  }

  const attachments = await readAttachments(await attachmentDir(paths, story.id));

  return { story: { ...story, attachmentCount: attachments.length }, names: attachments.map((a) => a.name) };
}

/** The filter of a search, with the field values in the types of the fields. */
interface SearchFilter {
  readonly stage: StageConfig | undefined;
  readonly fields: Readonly<Record<string, FieldValue>>;
  readonly tags: readonly string[];
}

/** Whether the story is in the stage of the filter and has each field value and each tag of the filter. */
function matchesFilter(story: Story, filter: SearchFilter): boolean {
  const { stage, fields, tags } = filter;

  return (
    (!stage || story.stage === stage.key) &&
    Object.entries(fields).every(([key, value]) => story.fields[key] === value) &&
    tags.every((tag) => story.tags.includes(tag))
  );
}

/** Whether the story agrees with the dependency filter. Without a filter, each story agrees. */
function matchesDependency(
  index: DependencyIndex,
  stages: readonly StageConfig[],
  story: Story,
  dependency: SearchStoriesInput["dependency"],
): boolean {
  return dependency === undefined || indexedIsBlocked(index, stages, story.id) === (dependency === "blocked");
}

/** Gives the filter of a search, with values of the field types. Throws when a field, a value or a tag is invalid. */
function searchFilter(config: ProjectConfig, input: SearchStoriesInput): SearchFilter {
  const stage = input.stage === undefined ? undefined : lookupStage(config, input.stage);
  const stageIssues = input.stage === undefined ? [] : unknownStageIssues(config, input.stage, ["stage"]);
  const fields = fieldUpdates(config, input.fields ?? {});

  throwIfIssues("The search is invalid", [...stageIssues, ...fields.issues]);

  return { stage, fields: fields.values, tags: checkedTags(config, input.tags ?? [], ["tags"]) };
}

/** Stories matching every filter given, in board order: by stage, then by position in the stage. With no filters, every story. */
export async function searchStories(input: SearchStoriesInput = {}, ctx: ServiceContext = {}): Promise<Story[]> {
  const paths = await findProject(ctx);
  const config = await readConfig(paths);
  const filter = searchFilter(config, input);

  const words = (input.query ?? "").toLowerCase().split(/\s+/).filter(Boolean);
  const files = await readStoryFiles(paths);
  const sorted = sortStoryFiles(files).toSorted((a, b) => stageIndex(config, a) - stageIndex(config, b));
  const positions = stagePositions(sorted);
  const stories = sorted.map((file) => toStory(config, file, positions.get(file.id)));
  const index = dependencyIndex(stories);
  const filtered = stories.filter(
    (story) => matchesFilter(story, filter) && matchesDependency(index, config.stages, story, input.dependency),
  );
  const owners = new Set(await attachmentOwners(paths));
  const found = await Promise.all(filtered.map((story) => withAttachmentNames(paths, owners, story)));

  return found.filter(({ story, names }) => matchesQuery(story, words, names)).map(({ story }) => story);
}
