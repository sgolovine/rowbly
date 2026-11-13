import { mkdir, readFile, rename } from "node:fs/promises";
import { basename, resolve } from "node:path";
import { moveAttachmentDirs } from "../attachment-files/attachment-files.js";
import {
  type CustomField,
  checkProjectKey,
  type FeatureConfig,
  type Issue,
  type ProjectConfig,
  readConfig,
  throwIfIssues,
  toProjectKey,
  writeConfig,
} from "../config/config.js";
import { ConflictError } from "../errors/errors.js";
import { pathExists, writeFileAtomic } from "../files/files.js";
import { ensureRuntimeIgnores } from "../runtime-files/runtime-files.js";
import { canonicalStoryId, rewriteSpecLinks } from "../spec-files/spec-files.js";
import { formatStoryId, readStoryFiles, storyPath } from "../story-files/story-files.js";
import { findProject, type ProjectPaths, projectPaths, type ServiceContext } from "../workspace/workspace.js";

export interface Project extends ProjectConfig {
  /** The directory that contains `.rowbly/`. */
  root: string;
}

export interface ProjectInstructions {
  /** The absolute path of `ROWBLY.md`, also when the file does not exist. */
  path: string;
  /** Top-level instructions for every agent that works on the project. Empty when there is no `ROWBLY.md`. */
  instructions: string;
}

export interface InitProjectInput {
  /** Defaults to the directory's name. */
  name?: string;
  /** Defaults to the first three letters of the name: `Rowbly` → `ROW`. */
  key?: string;
  /** In board order. Defaults to Backlog and Done. */
  stages?: InitialStage[];
  customFields?: CustomField[];
}

/** A stage of a new project, and the text of its prompt file. */
interface InitialStage {
  key: string;
  label: string;
  prompt: string;
}

export interface UpdateProjectInput {
  name?: string;
  /** Renames every story file to the new key. */
  key?: string;
  /** Turns optional features on (`true`) or off (`false`). The features that are not named do not change. */
  features?: FeatureConfig;
}

/** The stages of a project when `initProject` gets no list. */
const DEFAULT_STAGES: InitialStage[] = [
  {
    key: "BACKLOG",
    label: "Backlog",
    prompt: "This story has not been started. Do not work on it until it moves to another stage.",
  },
  { key: "DONE", label: "Done", prompt: "This story is complete. No further work is needed." },
];

function nameIssues(name: string): Issue[] {
  return name.trim() === "" ? [{ path: ["name"], message: "Name is required" }] : [];
}

/** The name that `initProject` gives a project in `ctx.cwd` if the input has no name. */
export function defaultProjectName(ctx: ServiceContext = {}): string {
  return basename(resolve(ctx.cwd ?? process.cwd()));
}

/** Writes the prompt file of each stage, one at a time, in board order. */
async function writeStagePrompts(paths: ProjectPaths, stages: readonly InitialStage[]): Promise<void> {
  await stages.reduce<Promise<void>>(
    (previous, stage) =>
      previous.then(() => writeFileAtomic(resolve(paths.stagesDir, `${stage.key}.md`), `${stage.prompt.trimEnd()}\n`)),
    Promise.resolve(),
  );
}

/** Creates `.rowbly/` in `ctx.cwd` with a config, its stages and an empty stories folder. */
export async function initProject(input: InitProjectInput = {}, ctx: ServiceContext = {}): Promise<Project> {
  const root = resolve(ctx.cwd ?? process.cwd());
  const paths = projectPaths(root);
  const name = input.name ?? defaultProjectName(ctx);
  const projectName = name.trim();
  const projectKey = (input.key ?? toProjectKey(projectName)).trim().toUpperCase();

  throwIfIssues("The project is invalid", [...nameIssues(name), ...checkProjectKey(projectKey, ["key"])]);

  if (await pathExists(paths.dir)) {
    throw new ConflictError(`${paths.dir} already exists`, {
      hint: "Run `rowbly doctor` to check the existing project.",
    });
  }

  const stages = input.stages ?? DEFAULT_STAGES;
  const config: ProjectConfig = {
    projectName,
    projectKey,
    customFields: input.customFields ?? [],
    stages: stages.map(({ key, label }) => ({ key, label, enabled: true })),
  };

  await mkdir(paths.storiesDir, { recursive: true });
  await writeStagePrompts(paths, stages);
  await ensureRuntimeIgnores(paths);
  await writeFileAtomic(paths.instructionsFile, "# ROWBLY INSTRUCTIONS\n");
  await writeConfig(paths, config);

  return { ...config, root };
}

/** Gives the config of the project and the directory that contains `.rowbly/`. */
export async function getProject(ctx: ServiceContext = {}): Promise<Project> {
  const paths = await findProject(ctx);

  return { ...(await readConfig(paths)), root: paths.root };
}

/** Reads `.rowbly/ROWBLY.md`. Rowbly does not parse the text; agents obey it. */
export async function getInstructions(ctx: ServiceContext = {}): Promise<ProjectInstructions> {
  const { instructionsFile: path } = await findProject(ctx);

  return { path, instructions: (await pathExists(path)) ? (await readFile(path, "utf8")).trim() : "" };
}

/** The ID of a spec link with the new key. A link that does not use the old key stays the same. */
function renamedLink(id: string, oldKey: string, newKey: string): string {
  const canonical = canonicalStoryId(oldKey, id);

  return canonical ? formatStoryId(newKey, Number(canonical.slice(oldKey.length + 1))) : id;
}

/** Renames the story files, their attachment folders and the spec links to the new key. */
async function renameStoryKey(paths: ProjectPaths, oldKey: string, newKey: string): Promise<void> {
  const files = await readStoryFiles(paths);
  const owned = files.filter((file) => file.projectKey === oldKey);
  const taken = files.filter((file) => file.projectKey === newKey).map((file) => file.id);

  if (taken.length > 0) {
    throw new ConflictError(`Stories with the key ${newKey} already exist: ${taken.join(", ")}`);
  }

  await moveAttachmentDirs(
    paths,
    owned.map((file) => ({ from: file.id, to: formatStoryId(newKey, file.number) })),
  );
  // Each rename waits for the previous one, so the files move one at a time, in order.
  await owned.reduce<Promise<void>>(
    (previous, file) => previous.then(() => rename(file.path, storyPath(paths, newKey, file.number))),
    Promise.resolve(),
  );
  await rewriteSpecLinks(paths, (stories) => stories.map((id) => renamedLink(id, oldKey, newKey)));
}

/** Changes the name, the key or the features of the project. A new key renames every story. */
export async function updateProject(input: UpdateProjectInput, ctx: ServiceContext = {}): Promise<Project> {
  const paths = await findProject(ctx);
  const config = await readConfig(paths);
  const projectName = input.name === undefined ? config.projectName : input.name.trim();
  const projectKey = input.key === undefined ? config.projectKey : input.key.trim().toUpperCase();

  throwIfIssues("The project is invalid", [
    ...(input.name === undefined ? [] : nameIssues(input.name)),
    ...checkProjectKey(projectKey, ["key"]),
  ]);

  if (projectKey !== config.projectKey) {
    await renameStoryKey(paths, config.projectKey, projectKey);
  }

  const features = input.features === undefined ? config.features : { ...config.features, ...input.features };
  const updated = { ...config, projectName, projectKey, ...(features === undefined ? {} : { features }) };

  await writeConfig(paths, updated);

  return { ...updated, root: paths.root };
}
