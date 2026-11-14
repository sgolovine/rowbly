import { readFile } from "node:fs/promises";
import { writeFileAtomic } from "../files/files.js";
import type { ProjectPaths } from "../workspace/workspace.js";
import { configIssues } from "./config-issues.js";
import { throwIfIssues } from "./config-keys.js";
import { FEATURES, type Feature, type Issue, type ProjectConfig } from "./config-types.js";

export { configIssues } from "./config-issues.js";
export * from "./config-keys.js";
export * from "./config-types.js";

/** Tells if the optional feature is on in the config. */
export function featureEnabled(config: ProjectConfig, feature: Feature): boolean {
  return config.features?.[feature] === true;
}

/** Gives the parsed JSON, or the message of the syntax error. */
function parseJson(text: string): { ok: true; value: unknown } | { ok: false; message: string } {
  try {
    return { ok: true, value: JSON.parse(text) };
  } catch (error) {
    return { ok: false, message: (error as Error).message };
  }
}

/** Parses the config file's text; a JSON syntax error is an issue, not a throw. */
export function parseConfig(text: string): { config?: ProjectConfig; issues: Issue[] } {
  const parsed = parseJson(text);

  if (!parsed.ok) {
    return { issues: [{ path: [], message: `The config is not valid JSON: ${parsed.message}` }] };
  }

  const issues = configIssues(parsed.value);

  return issues.length > 0 ? { issues } : { config: normalizeConfig(parsed.value as ProjectConfig), issues };
}

/** Keeps only the keys Rowbly knows, in a stable order. */
function normalizeConfig(config: ProjectConfig): ProjectConfig {
  return {
    projectName: config.projectName,
    projectKey: config.projectKey,
    customFields: config.customFields.map(({ key, label, type, options }) =>
      options === undefined ? { key, label, type } : { key, label, type, options },
    ),
    stages: config.stages.map(({ key, label, enabled }) => ({ key, label, enabled })),
    ...(config.features === undefined
      ? {}
      : {
          features: Object.fromEntries(
            FEATURES.filter((f) => f in (config.features ?? {})).map((f) => [f, config.features?.[f]]),
          ),
        }),
    ...(config.skills === undefined
      ? {}
      : { skills: config.skills.map(({ name, harnesses }) => ({ name, harnesses: [...harnesses] })) }),
    ...(config.factory === undefined ? {} : { factory: config.factory }),
  };
}

/** Reads and checks the config file. Throws a `ValidationError` with the issues when the file is invalid. */
export async function readConfig(paths: ProjectPaths): Promise<ProjectConfig> {
  const { config, issues } = parseConfig(await readFile(paths.configFile, "utf8"));

  throwIfIssues(`${paths.configFile} is invalid`, issues, "Fix the file by hand, then run `rowbly doctor`.");

  return config as ProjectConfig;
}

/** Writes the config file with only the known keys, in a stable order. */
export async function writeConfig(paths: ProjectPaths, config: ProjectConfig): Promise<void> {
  await writeFileAtomic(paths.configFile, `${JSON.stringify(normalizeConfig(config), null, 2)}\n`);
}
