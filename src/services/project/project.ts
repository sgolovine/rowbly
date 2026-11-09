import { mkdir, rename } from "node:fs/promises";
import { basename, resolve } from "node:path";
import {
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
import { canonicalStoryId, rewriteSpecLinks } from "../specFiles/specFiles.js";
import { formatStoryId, readStoryFiles, storyPath } from "../storyFiles/storyFiles.js";
import { findProject, projectPaths, type ServiceContext } from "../workspace/workspace.js";

export interface Project extends ProjectConfig {
  /** The directory that contains `.rowbly/`. */
  root: string;
}

export interface InitProjectInput {
  /** Defaults to the directory's name. */
  name?: string;
  /** Defaults to one made from the name: `My Project` → `MP`. */
  key?: string;
}

export interface UpdateProjectInput {
  name?: string;
  /** Renames every story file to the new key. */
  key?: string;
  /** Turns optional features on (`true`) or off (`false`). The features that are not named do not change. */
  features?: FeatureConfig;
}

/** Every new project starts with these stages. */
const DEFAULT_STAGES = [
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

/** Creates `.rowbly/` in `ctx.cwd` with a config, the default stages and an empty stories folder. */
export async function initProject(input: InitProjectInput = {}, ctx: ServiceContext = {}): Promise<Project> {
  const root = resolve(ctx.cwd ?? process.cwd());
  const paths = projectPaths(root);
  const issues: Issue[] = [];
  const projectName = checkName(input.name ?? basename(root), issues);
  const projectKey = (input.key ?? toProjectKey(projectName)).trim().toUpperCase();
  issues.push(...checkProjectKey(projectKey, ["key"]));
  throwIfIssues("The project is invalid", issues);
  if (await pathExists(paths.dir)) {
    throw new ConflictError(`${paths.dir} already exists`, {
      hint: "Run `rowbly doctor` to check the existing project.",
    });
  }

  const config: ProjectConfig = {
    projectName,
    projectKey,
    customFields: [],
    stages: DEFAULT_STAGES.map(({ key, label }) => ({ key, label, enabled: true })),
  };
  await mkdir(paths.storiesDir, { recursive: true });
  for (const stage of DEFAULT_STAGES) {
    await writeFileAtomic(resolve(paths.stagesDir, `${stage.key}.md`), `${stage.prompt}\n`);
  }
  await writeConfig(paths, config);
  return { ...config, root };
}

export async function getProject(ctx: ServiceContext = {}): Promise<Project> {
  const paths = await findProject(ctx);
  return { ...(await readConfig(paths)), root: paths.root };
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
