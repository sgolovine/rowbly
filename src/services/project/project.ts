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
import { findProject, projectPaths, type ServiceContext } from "../workspace/workspace.js";

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

function checkName(name: string, issues: Issue[]): string {
  if (name.trim() === "") issues.push({ path: ["name"], message: "Name is required" });
  return name.trim();
}

/** The name that `initProject` gives a project in `ctx.cwd` if the input has no name. */
export function defaultProjectName(ctx: ServiceContext = {}): string {
  return basename(resolve(ctx.cwd ?? process.cwd()));
}

/** Creates `.rowbly/` in `ctx.cwd` with a config, its stages and an empty stories folder. */
export async function initProject(input: InitProjectInput = {}, ctx: ServiceContext = {}): Promise<Project> {
  const root = resolve(ctx.cwd ?? process.cwd());
  const paths = projectPaths(root);
  const issues: Issue[] = [];
  const projectName = checkName(input.name ?? defaultProjectName(ctx), issues);
  const projectKey = (input.key ?? toProjectKey(projectName)).trim().toUpperCase();
  issues.push(...checkProjectKey(projectKey, ["key"]));
  throwIfIssues("The project is invalid", issues);
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
  for (const stage of stages) {
    await writeFileAtomic(resolve(paths.stagesDir, `${stage.key}.md`), `${stage.prompt.trimEnd()}\n`);
  }
  await ensureRuntimeIgnores(paths);
  await writeFileAtomic(paths.instructionsFile, "# ROWBLY INSTRUCTIONS\n");
  await writeConfig(paths, config);
  return { ...config, root };
}

export async function getProject(ctx: ServiceContext = {}): Promise<Project> {
  const paths = await findProject(ctx);
  return { ...(await readConfig(paths)), root: paths.root };
}

/** Reads `.rowbly/ROWBLY.md`. Rowbly does not parse the text; agents obey it. */
export async function getInstructions(ctx: ServiceContext = {}): Promise<ProjectInstructions> {
  const { instructionsFile: path } = await findProject(ctx);
  return { path, instructions: (await pathExists(path)) ? (await readFile(path, "utf8")).trim() : "" };
}

export async function updateProject(input: UpdateProjectInput, ctx: ServiceContext = {}): Promise<Project> {
  const paths = await findProject(ctx);
  const config = await readConfig(paths);
  const issues: Issue[] = [];
  const projectName = input.name === undefined ? config.projectName : checkName(input.name, issues);
  const projectKey = input.key === undefined ? config.projectKey : input.key.trim().toUpperCase();
  issues.push(...checkProjectKey(projectKey, ["key"]));
  throwIfIssues("The project is invalid", issues);

  if (projectKey !== config.projectKey) {
    const files = await readStoryFiles(paths);
    const moves = files
      .filter((file) => file.projectKey === config.projectKey)
      .map((file) => ({ from: file.path, to: storyPath(paths, projectKey, file.number) }));
    const taken = files.filter((file) => file.projectKey === projectKey).map((file) => file.id);
    if (taken.length > 0) {
      throw new ConflictError(`Stories with the key ${projectKey} already exist: ${taken.join(", ")}`);
    }
    await moveAttachmentDirs(
      paths,
      files
        .filter((f) => f.projectKey === config.projectKey)
        .map((f) => ({
          from: f.id,
          to: formatStoryId(projectKey, f.number),
        })),
    );
    for (const move of moves) await rename(move.from, move.to);
    const old = config.projectKey;
    await rewriteSpecLinks(paths, (stories) =>
      stories.map((id) => {
        const canonical = canonicalStoryId(old, id);
        return canonical ? formatStoryId(projectKey, Number(canonical.slice(old.length + 1))) : id;
      }),
    );
  }
  const features = input.features === undefined ? config.features : { ...config.features, ...input.features };
  const updated = { ...config, projectName, projectKey, ...(features === undefined ? {} : { features }) };
  await writeConfig(paths, updated);
  return { ...updated, root: paths.root };
}
