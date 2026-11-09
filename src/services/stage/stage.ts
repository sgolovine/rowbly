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
import { readStoryFiles, rewriteStories } from "../storyFiles/storyFiles.js";
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

/** Finds a stage by key, ignoring case. When it is missing, records an issue at `path`. */
export function findStage(
  config: ProjectConfig,
  key: string,
  path: Issue["path"],
  issues: Issue[],
): StageConfig | undefined {
  const stage = config.stages.find((s) => s.key === key.trim().toUpperCase());
  if (!stage) {
    issues.push({ path, message: `Unknown stage "${key}". Stages: ${config.stages.map((s) => s.key).join(", ")}` });
  }
  return stage;
}

function requireStage(config: ProjectConfig, key: string): StageConfig {
  const issues: Issue[] = [];
  const stage = findStage(config, key, ["key"], issues);
  if (!stage) throw new NotFoundError(issues[0]?.message ?? `Stage ${key} not found`);
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

function checkPosition(position: number | undefined, count: number, issues: Issue[]): void {
  if (position !== undefined && (!Number.isInteger(position) || position < 1 || position > count)) {
    issues.push({ path: ["position"], message: `Position must be a whole number from 1 to ${count}` });
  }
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

export async function getStage(input: { key: string }, ctx: ServiceContext = {}): Promise<Stage> {
  const paths = await findProject(ctx);
  const config = await readConfig(paths);
  return toStage(paths, config, requireStage(config, input.key));
}

export async function createStage(input: CreateStageInput, ctx: ServiceContext = {}): Promise<Stage> {
  const paths = await findProject(ctx);
  const config = await readConfig(paths);
  const label = input.label.trim();
  const key = (input.key ?? toStageKey(label)).trim().toUpperCase();
  const issues: Issue[] = [];
  if (!label) issues.push({ path: ["label"], message: "Label is required" });
  issues.push(...checkStageKey(key));
  checkPosition(input.position, config.stages.length + 1, issues);
  throwIfIssues("The stage is invalid", issues);
  if (config.stages.some((s) => s.key === key)) throw new ConflictError(`Stage ${key} already exists`);

  const stage: StageConfig = { key, label, enabled: input.enabled ?? true };
  config.stages.splice((input.position ?? config.stages.length + 1) - 1, 0, stage);
  await writePrompt(paths, key, input.prompt ?? "");
  await writeConfig(paths, config);
  return toStage(paths, config, stage);
}

export async function updateStage(input: UpdateStageInput, ctx: ServiceContext = {}): Promise<Stage> {
  const paths = await findProject(ctx);
  const config = await readConfig(paths);
  const stage = requireStage(config, input.key);
  const oldKey = stage.key;
  const newKey = input.newKey?.trim().toUpperCase() ?? oldKey;
  const issues: Issue[] = [];
  if (input.label !== undefined && input.label.trim() === "") {
    issues.push({ path: ["label"], message: "Label is required" });
  }
  issues.push(...checkStageKey(newKey, ["newKey"]));
  checkPosition(input.position, config.stages.length, issues);
  throwIfIssues("The stage is invalid", issues);
  if (newKey !== oldKey && config.stages.some((s) => s.key === newKey)) {
    throw new ConflictError(`Stage ${newKey} already exists`);
  }

  if (input.label !== undefined) stage.label = input.label.trim();
  if (input.enabled !== undefined) stage.enabled = input.enabled;
  if (input.position !== undefined) {
    config.stages.splice(config.stages.indexOf(stage), 1);
    config.stages.splice(input.position - 1, 0, stage);
  }
  if (newKey !== oldKey) {
    stage.key = newKey;
    if (await pathExists(stageFile(paths, oldKey))) await rename(stageFile(paths, oldKey), stageFile(paths, newKey));
    await rewriteStories(paths, config, (data) => {
      if (data.stage !== oldKey) return false;
      data.stage = newKey;
      return true;
    });
  }
  if (input.prompt !== undefined) await writePrompt(paths, newKey, input.prompt);
  await writeConfig(paths, config);
  return toStage(paths, config, stage);
}

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
  const issues: Issue[] = [];
  const target =
    input.moveStoriesTo === undefined ? undefined : findStage(config, input.moveStoriesTo, ["moveStoriesTo"], issues);
  if (target === stage) issues.push({ path: ["moveStoriesTo"], message: "Move the stories to a different stage" });
  throwIfIssues("Cannot delete the stage", issues);

  const inStage = (await readStoryFiles(paths)).filter((file) => file.doc.data.stage === stage.key);
  if (inStage.length > 0 && !target) {
    throw new ConflictError(`Stage ${stage.key} has ${inStage.length} ${inStage.length === 1 ? "story" : "stories"}`, {
      hint: "Choose a stage to move them to (`--move-to <stage>`).",
      details: { stories: inStage.map((file) => file.id) },
    });
  }

  config.stages.splice(config.stages.indexOf(stage), 1);
  let movedStories = 0;
  if (target) {
    movedStories = await rewriteStories(paths, config, (data) => {
      if (data.stage !== stage.key) return false;
      data.stage = target.key;
      return true;
    });
  }
  await writeConfig(paths, config);
  await rm(stageFile(paths, stage.key), { force: true });
  return { key: stage.key, movedStories };
}
