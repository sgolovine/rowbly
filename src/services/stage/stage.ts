import { readFile, rename, rm } from "node:fs/promises";
import { join } from "node:path";
import {
  checkStageKey,
  type Issue,
  type ProjectConfig,
  readConfig,
  type StageConfig,
  throwIfIssues,
  toStageKey,
  writeConfig,
} from "../config/config.js";
import { ConflictError, NotFoundError, ValidationError } from "../errors/errors.js";
import { pathExists, writeFileAtomic } from "../files/files.js";
import { readStoryFiles, rewriteStories } from "../story-files/story-files.js";
import { findProject, type ProjectPaths, type ServiceContext } from "../workspace/workspace.js";

export interface Stage extends StageConfig {
  /** Tells agents how to handle a story in this stage: the body of `stages/<key>.md`. */
  prompt: string;
  /** 1-based place in board order. */
  position: number;
}

export interface CreateStageInput {
  label: string;
  /** Defaults to the label in UPPER_SNAKE_CASE. */
  key?: string;
  enabled?: boolean;
  prompt?: string;
  /** 1-based. Defaults to the end. */
  position?: number;
}

export interface UpdateStageInput {
  key: string;
  /** Renames the stage: its file and every story in it follow. */
  newKey?: string;
  label?: string;
  enabled?: boolean;
  prompt?: string;
  position?: number;
}

export interface DeleteStageInput {
  key: string;
  /** Moves the stage's stories here. Without it, a stage with stories cannot be deleted. */
  moveStoriesTo?: string;
}

/** Finds a stage by key, ignoring case. */
export function lookupStage(config: ProjectConfig, key: string): StageConfig | undefined {
  return config.stages.find((s) => s.key === key.trim().toUpperCase());
}

/** Gives an issue at `path` when no stage has the key. */
export function unknownStageIssues(config: ProjectConfig, key: string, path: Issue["path"]): Issue[] {
  return lookupStage(config, key)
    ? []
    : [{ path, message: `Unknown stage "${key}". Stages: ${config.stages.map((s) => s.key).join(", ")}` }];
}

function requireStage(config: ProjectConfig, key: string): StageConfig {
  const stage = lookupStage(config, key);

  if (!stage) {
    throw new NotFoundError(unknownStageIssues(config, key, ["key"])[0]?.message ?? `Stage ${key} not found`);
  }

  return stage;
}

function stageFile(paths: ProjectPaths, key: string): string {
  return join(paths.stagesDir, `${key}.md`);
}

async function readPrompt(paths: ProjectPaths, key: string): Promise<string> {
  const file = stageFile(paths, key);

  return (await pathExists(file)) ? (await readFile(file, "utf8")).trim() : "";
}

async function writePrompt(paths: ProjectPaths, key: string, prompt: string): Promise<void> {
  const text = prompt.trim();

  await writeFileAtomic(stageFile(paths, key), text ? `${text}\n` : "");
}

function positionIssues(position: number | undefined, count: number): Issue[] {
  if (position !== undefined && (!Number.isInteger(position) || position < 1 || position > count)) {
    return [{ path: ["position"], message: `Position must be a whole number from 1 to ${count}` }];
  }

  return [];
}

function labelIssues(label: string | undefined): Issue[] {
  return label !== undefined && label.trim() === "" ? [{ path: ["label"], message: "Label is required" }] : [];
}

async function toStage(paths: ProjectPaths, config: ProjectConfig, stage: StageConfig): Promise<Stage> {
  return { ...stage, prompt: await readPrompt(paths, stage.key), position: config.stages.indexOf(stage) + 1 };
}

/** Every stage, in board order. */
export async function listStages(ctx: ServiceContext = {}): Promise<Stage[]> {
  const paths = await findProject(ctx);
  const config = await readConfig(paths);

  return Promise.all(config.stages.map((stage) => toStage(paths, config, stage)));
}

/** Gives the stage with the key, ignoring case. */
export async function getStage(input: { key: string }, ctx: ServiceContext = {}): Promise<Stage> {
  const paths = await findProject(ctx);
  const config = await readConfig(paths);

  return toStage(paths, config, requireStage(config, input.key));
}

/** Adds a stage at `position`, or at the end, and writes its prompt file. */
export async function createStage(input: CreateStageInput, ctx: ServiceContext = {}): Promise<Stage> {
  const paths = await findProject(ctx);
  const config = await readConfig(paths);
  const label = input.label.trim();
  const key = (input.key ?? toStageKey(label)).trim().toUpperCase();

  throwIfIssues("The stage is invalid", [
    ...labelIssues(label),
    ...checkStageKey(key),
    ...positionIssues(input.position, config.stages.length + 1),
  ]);

  if (config.stages.some((s) => s.key === key)) {
    throw new ConflictError(`Stage ${key} already exists`);
  }

  const stage: StageConfig = { key, label, enabled: input.enabled ?? true };
  const next = {
    ...config,
    stages: config.stages.toSpliced((input.position ?? config.stages.length + 1) - 1, 0, stage),
  };

  await writePrompt(paths, key, input.prompt ?? "");
  await writeConfig(paths, next);

  return toStage(paths, next, stage);
}

/** The stages with `stage` replaced by `updated`, at the new position when the input has one. */
function updatedStages(
  config: ProjectConfig,
  stage: StageConfig,
  updated: StageConfig,
  position?: number,
): StageConfig[] {
  const index = config.stages.indexOf(stage);

  return position === undefined
    ? config.stages.with(index, updated)
    : config.stages.toSpliced(index, 1).toSpliced(position - 1, 0, updated);
}

/** Renames the prompt file of a stage, and moves the stories of the stage to the new key. */
async function renameStage(paths: ProjectPaths, config: ProjectConfig, oldKey: string, newKey: string): Promise<void> {
  if (await pathExists(stageFile(paths, oldKey))) {
    await rename(stageFile(paths, oldKey), stageFile(paths, newKey));
  }

  await rewriteStories(paths, config, (data) => (data.stage === oldKey ? { ...data, stage: newKey } : false));
}

/** Changes a stage. A new key renames the prompt file and moves the stories of the stage. */
export async function updateStage(input: UpdateStageInput, ctx: ServiceContext = {}): Promise<Stage> {
  const paths = await findProject(ctx);
  const config = await readConfig(paths);
  const stage = requireStage(config, input.key);
  const oldKey = stage.key;
  const newKey = input.newKey?.trim().toUpperCase() ?? oldKey;

  throwIfIssues("The stage is invalid", [
    ...labelIssues(input.label),
    ...checkStageKey(newKey, ["newKey"]),
    ...positionIssues(input.position, config.stages.length),
  ]);

  if (newKey !== oldKey && config.stages.some((s) => s.key === newKey)) {
    throw new ConflictError(`Stage ${newKey} already exists`);
  }

  const updated: StageConfig = {
    key: newKey,
    label: input.label?.trim() ?? stage.label,
    enabled: input.enabled ?? stage.enabled,
  };
  const next = { ...config, stages: updatedStages(config, stage, updated, input.position) };

  if (newKey !== oldKey) {
    await renameStage(paths, next, oldKey, newKey);
  }

  if (input.prompt !== undefined) {
    await writePrompt(paths, newKey, input.prompt);
  }

  await writeConfig(paths, next);

  return toStage(paths, next, updated);
}

/** The stage that gets the stories of the deleted stage. Throws when the input does not name a different stage. */
function moveTarget(config: ProjectConfig, stage: StageConfig, moveStoriesTo?: string): StageConfig | undefined {
  const target = moveStoriesTo === undefined ? undefined : lookupStage(config, moveStoriesTo);
  const unknown = moveStoriesTo === undefined ? [] : unknownStageIssues(config, moveStoriesTo, ["moveStoriesTo"]);
  const same = target === stage ? [{ path: ["moveStoriesTo"], message: "Move the stories to a different stage" }] : [];

  throwIfIssues("Cannot delete the stage", [...unknown, ...same]);

  return target;
}

/** Deletes a stage and its prompt file. A stage with stories needs a stage to move them to. */
export async function deleteStage(
  input: DeleteStageInput,
  ctx: ServiceContext = {},
): Promise<{ key: string; movedStories: number }> {
  const paths = await findProject(ctx);
  const config = await readConfig(paths);
  const stage = requireStage(config, input.key);

  if (config.stages.length === 1) {
    throw new ValidationError("A project needs at least one stage", { hint: "Create another stage first." });
  }

  const target = moveTarget(config, stage, input.moveStoriesTo);
  const inStage = (await readStoryFiles(paths)).filter((file) => file.doc.data.stage === stage.key);

  if (inStage.length > 0 && !target) {
    throw new ConflictError(`Stage ${stage.key} has ${inStage.length} ${inStage.length === 1 ? "story" : "stories"}`, {
      hint: "Choose a stage to move them to (`--move-to <stage>`).",
      details: { stories: inStage.map((file) => file.id) },
    });
  }

  const next = { ...config, stages: config.stages.filter((s) => s !== stage) };
  const movedStories = target
    ? await rewriteStories(paths, next, (data) => (data.stage === stage.key ? { ...data, stage: target.key } : false))
    : 0;

  await writeConfig(paths, next);
  await rm(stageFile(paths, stage.key), { force: true });

  return { key: stage.key, movedStories };
}
