import { rm } from "node:fs/promises";
import { type Issue, type ProjectConfig, readConfig, throwIfIssues } from "../config/config.js";
import { ConflictError, NotFoundError } from "../errors/errors.js";
import { coerceFieldValue, type FieldValue, fieldValueError } from "../fields/fields.js";
import { rewriteSpecLinks } from "../specFiles/specFiles.js";
import { findStage } from "../stage/stage.js";
import {
  dropAgentLock,
  formatStoryId,
  parseAgentLock,
  readStoryFiles,
  type StoryAgentLock,
  type StoryFile,
  sortStoryFiles,
  storyPath,
  writeStoryFile,
} from "../storyFiles/storyFiles.js";
import { findProject, type ProjectPaths, type ServiceContext } from "../workspace/workspace.js";

/** @public */
export type { StoryAgentLock };

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
  /** The agent that works on the story in its current stage, `null` when there is none. */
  agentLock: StoryAgentLock | null;
  path: string;
}

/**
 * Custom field values by key. A string is parsed by the field's type, so text input works as-is.
 * @public
 */
export type FieldInput = Record<string, unknown>;

export interface CreateStoryInput {
  title: string;
  /** A stage key. Defaults to the first enabled stage. */
  stage?: string;
  description?: string;
  fields?: FieldInput;
}

export interface UpdateStoryInput {
  id: string;
  title?: string;
  stage?: string;
  /** The 1-based place in the stage, clamped to it. A story that changes stage without one goes last. */
  position?: number;
  description?: string;
  /** Only the fields to change; `null` or `""` clears one. */
  fields?: FieldInput;
}

export interface LockStoryInput {
  id: string;
  /** The name of the agent that takes the lock. */
  agent: string;
}

export interface UnlockStoryInput {
  id: string;
  /** When given, only this agent can remove the lock. */
  agent?: string;
}

export interface SearchStoriesInput {
  /** Every word must appear in the ID, title, description or a text field value. */
  query?: string;
  stage?: string;
  /** Stories whose fields equal these values. */
  fields?: FieldInput;
}

const INVALID_STORY_HINT = "Run `rowbly doctor` to find and fix problems in story files.";

/** Checks a story file against the config and returns it as a `Story` at `position` in its stage. */
function toStory(config: ProjectConfig, file: StoryFile, position = 1): Story {
  const { data, body } = file.doc;
  const issues: Issue[] = [];
  if (typeof data.title !== "string" || data.title.trim() === "") {
    issues.push({ path: ["title"], message: "Title is required" });
  }
  if (typeof data.stage !== "string" || !config.stages.some((stage) => stage.key === data.stage)) {
    issues.push({ path: ["stage"], message: `Unknown stage "${String(data.stage ?? "")}"` });
  }
  const fields: Record<string, FieldValue> = {};
  for (const field of config.customFields) {
    const value = data[field.key] ?? null;
    const error = fieldValueError(field, value);
    if (error) issues.push({ path: [field.key], message: error });
    fields[field.key] = value as FieldValue;
  }
  throwIfIssues(
    `${file.id} is invalid: ${issues.map((issue) => issue.message).join("; ")}`,
    issues,
    INVALID_STORY_HINT,
  );
  // A lock from an earlier stage is stale: hand edits and git merges can leave one behind.
  const lock = parseAgentLock(data.agentLock);
  return {
    id: file.id,
    number: file.number,
    title: data.title as string,
    stage: data.stage as string,
    position,
    description: body,
    fields,
    agentLock: lock?.stage === data.stage ? lock : null,
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

async function findStoryFile(paths: ProjectPaths, config: ProjectConfig, id: string): Promise<StoryFile> {
  const number = parseStoryId(config, id);
  const file = (await readStoryFiles(paths)).find((f) => f.projectKey === config.projectKey && f.number === number);
  if (!file) throw new NotFoundError(`Story ${formatStoryId(config.projectKey, number)} not found`);
  return file;
}

/** Applies `fields` on top of `data`, collecting an issue for every unknown field or invalid value. */
function applyFields(config: ProjectConfig, data: Record<string, unknown>, fields: FieldInput, issues: Issue[]): void {
  for (const [key, value] of Object.entries(fields)) {
    const field = config.customFields.find((f) => f.key === key);
    if (!field) {
      issues.push({ path: [key], message: `Unknown custom field "${key}"` });
      continue;
    }
    const result = coerceFieldValue(field, value);
    if (result.ok) data[key] = result.value;
    else issues.push({ path: [key], message: result.error });
  }
}

function checkTitle(title: string, issues: Issue[]): string {
  if (title.trim() === "") issues.push({ path: ["title"], message: "Title is required" });
  return title.trim();
}

export async function createStory(input: CreateStoryInput, ctx: ServiceContext = {}): Promise<Story> {
  const paths = await findProject(ctx);
  const config = await readConfig(paths);
  const issues: Issue[] = [];
  const stage =
    input.stage === undefined
      ? (config.stages.find((s) => s.enabled) ?? config.stages[0])
      : findStage(config, input.stage, ["stage"], issues);
  const data: Record<string, unknown> = { title: checkTitle(input.title, issues), stage: stage?.key };
  for (const field of config.customFields) data[field.key] = null;
  applyFields(config, data, input.fields ?? {}, issues);
  throwIfIssues("The story is invalid", issues);

  const files = await readStoryFiles(paths);
  const number = Math.max(0, ...files.map((file) => file.number)) + 1;
  const path = storyPath(paths, config.projectKey, number);
  await writeStoryFile(config, path, { data, body: input.description ?? "" });
  return getStory({ id: String(number) }, ctx);
}

export async function getStory(input: { id: string }, ctx: ServiceContext = {}): Promise<Story> {
  const paths = await findProject(ctx);
  const config = await readConfig(paths);
  const file = await findStoryFile(paths, config, input.id);
  return toStory(config, file, positionIn(await readStoryFiles(paths), file));
}

export async function updateStory(input: UpdateStoryInput, ctx: ServiceContext = {}): Promise<Story> {
  const paths = await findProject(ctx);
  const config = await readConfig(paths);
  const file = await findStoryFile(paths, config, input.id);
  const data = { ...file.doc.data };
  const issues: Issue[] = [];
  if (input.title !== undefined) data.title = checkTitle(input.title, issues);
  if (input.stage !== undefined) data.stage = findStage(config, input.stage, ["stage"], issues)?.key;
  if (input.position !== undefined && (!Number.isInteger(input.position) || input.position < 1)) {
    issues.push({ path: ["position"], message: "Position must be a whole number from 1" });
  }
  applyFields(config, data, input.fields ?? {}, issues);
  throwIfIssues("The story is invalid", issues);

  const moved = data.stage !== file.doc.data.stage;
  // A lock counts only for the visit to its stage.
  if (moved) dropAgentLock(data);
  const doc = { data, body: input.description ?? file.doc.body };
  const files = await readStoryFiles(paths);
  // Checked before writing, so an update never leaves a story invalid.
  toStory(config, { ...file, doc });
  if (input.position === undefined && !moved) {
    await writeStoryFile(config, file.path, doc);
    return toStory(config, { ...file, doc }, positionIn(files, file));
  }
  // The other stories of the stage keep their order around the story; each one that moves is rewritten.
  const peers = sortStoryFiles(files.filter((f) => f.id !== file.id && f.doc.data.stage === data.stage));
  const at = Math.max(0, Math.min(peers.length, (input.position ?? peers.length + 1) - 1));
  const order = [...peers.slice(0, at), { ...file, doc }, ...peers.slice(at)];
  for (const [i, f] of order.entries()) {
    if (f.id !== file.id && f.doc.data.position === i + 1) continue;
    f.doc.data.position = i + 1;
    await writeStoryFile(config, f.path, f.doc);
  }
  return toStory(config, { ...file, doc }, at + 1);
}

function checkAgent(agent: string): string {
  const name = agent.trim();
  throwIfIssues("The agent lock is invalid", name === "" ? [{ path: ["agent"], message: "Agent is required" }] : []);
  return name;
}

/**
 * Records that `agent` works on the story, in its current stage. The same agent can lock again: the lock keeps
 * its `lockedAt`. This is a record of work, not mutual exclusion: two processes can race on the file.
 */
export async function lockStory(input: LockStoryInput, ctx: ServiceContext = {}): Promise<Story> {
  const agent = checkAgent(input.agent);
  const paths = await findProject(ctx);
  const config = await readConfig(paths);
  const file = await findStoryFile(paths, config, input.id);
  const story = toStory(config, file, positionIn(await readStoryFiles(paths), file));
  if (story.agentLock?.agent === agent) return story;
  if (story.agentLock) {
    throw new ConflictError(`${story.id} is locked by ${story.agentLock.agent}`, {
      hint: `Wait for ${story.agentLock.agent}, or run \`rowbly unlock-story ${story.id}\` to remove the lock.`,
      details: { agentLock: story.agentLock },
    });
  }
  const lockedAt = (ctx.now?.() ?? new Date()).toISOString();
  const doc = { data: { ...file.doc.data, agentLock: { agent, stage: story.stage, lockedAt } }, body: file.doc.body };
  await writeStoryFile(config, file.path, doc);
  return toStory(config, { ...file, doc }, story.position);
}

/** Removes the agent lock of the story. With `agent`, a lock that a different agent holds is refused. */
export async function unlockStory(input: UnlockStoryInput, ctx: ServiceContext = {}): Promise<Story> {
  const agent = input.agent === undefined ? undefined : checkAgent(input.agent);
  const paths = await findProject(ctx);
  const config = await readConfig(paths);
  const file = await findStoryFile(paths, config, input.id);
  const story = toStory(config, file, positionIn(await readStoryFiles(paths), file));
  if (!story.agentLock) throw new NotFoundError(`${story.id} has no agent lock`);
  if (agent !== undefined && story.agentLock.agent !== agent) {
    throw new ConflictError(`${story.id} is locked by ${story.agentLock.agent}, not ${agent}`, {
      hint: `Run \`rowbly unlock-story ${story.id}\` without --agent to remove the lock.`,
      details: { agentLock: story.agentLock },
    });
  }
  const { agentLock: _removed, ...data } = file.doc.data;
  const doc = { data, body: file.doc.body };
  await writeStoryFile(config, file.path, doc);
  return toStory(config, { ...file, doc }, story.position);
}

export async function deleteStory(input: { id: string }, ctx: ServiceContext = {}): Promise<{ id: string }> {
  const paths = await findProject(ctx);
  const config = await readConfig(paths);
  const file = await findStoryFile(paths, config, input.id);
  await rm(file.path);
  // A spec that loses its last Story stays, and `doctor` reports it as an orphan.
  await rewriteSpecLinks(paths, (stories) => stories.filter((id) => id !== file.id));
  return { id: file.id };
}

function matchesQuery(story: Story, words: string[]): boolean {
  const text = [story.id, story.title, story.description, ...Object.values(story.fields).filter((v) => v !== null)]
    .join("\n")
    .toLowerCase();
  return words.every((word) => text.includes(word));
}

/** The 1-based place of `file` among the stories of its stage. */
function positionIn(files: readonly StoryFile[], file: StoryFile): number {
  const peers = sortStoryFiles(files.filter((f) => f.doc.data.stage === file.doc.data.stage));
  return peers.findIndex((f) => f.id === file.id) + 1;
}

/** Stories matching every filter given, in board order: by stage, then by position in the stage. With no filters, every story. */
export async function searchStories(input: SearchStoriesInput = {}, ctx: ServiceContext = {}): Promise<Story[]> {
  const paths = await findProject(ctx);
  const config = await readConfig(paths);
  const issues: Issue[] = [];
  const stage = input.stage === undefined ? undefined : findStage(config, input.stage, ["stage"], issues);
  const fields: Record<string, unknown> = {};
  applyFields(config, fields, input.fields ?? {}, issues);
  throwIfIssues("The search is invalid", issues);

  const words = (input.query ?? "").toLowerCase().split(/\s+/).filter(Boolean);
  const files = await readStoryFiles(paths);
  const stageOrder = (file: StoryFile) => {
    const index = config.stages.findIndex((s) => s.key === file.doc.data.stage);
    return index === -1 ? config.stages.length : index;
  };
  const sorted = sortStoryFiles(files).sort((a, b) => stageOrder(a) - stageOrder(b));
  const position = new Map<string, number>();
  const stories = sorted.map((file) => {
    const key = String(file.doc.data.stage);
    position.set(key, (position.get(key) ?? 0) + 1);
    return toStory(config, file, position.get(key));
  });
  return stories.filter(
    (story) =>
      (!stage || story.stage === stage.key) &&
      Object.entries(fields).every(([key, value]) => story.fields[key] === value) &&
      matchesQuery(story, words),
  );
}
