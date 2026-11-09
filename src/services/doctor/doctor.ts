import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join, relative } from "node:path";
import { labelFromKey, type ProjectConfig, parseConfig, STAGE_KEY_PATTERN, writeConfig } from "../config/config.js";
import { RowblyError } from "../errors/errors.js";
import { coerceFieldValue, fieldValueError } from "../fields/fields.js";
import { listMarkdownFiles, pathExists, pathOccupied } from "../files/files.js";
import { type MarkdownDocument, parseMarkdown } from "../markdown/markdown.js";
import { bundledSkills, copySkill, SKILL_FILE, skillPath } from "../skill/skill.js";
import {
  canonicalStoryId,
  SPEC_KEYS,
  SPEC_SLUG_PATTERN,
  type SpecFile,
  writeSpecFile,
} from "../specFiles/specFiles.js";
import {
  formatStoryId,
  parseAgentLock,
  parseStoryFileName,
  type StoryFile,
  writeStoryFile,
} from "../storyFiles/storyFiles.js";
import { findProject, type ProjectPaths, type ServiceContext } from "../workspace/workspace.js";

export interface DoctorIssue {
  /** An `error` breaks a rule; a `warning` is allowed but probably a mistake. */
  severity: "error" | "warning";
  message: string;
  /** Relative to the project root. */
  file: string;
  /** What `--fix` does about it, when it can do anything. */
  fix?: string;
  /** Whether this run fixed it. */
  fixed: boolean;
}

export interface DoctorReport {
  root: string;
  issues: DoctorIssue[];
  /** No unfixed errors. */
  ok: boolean;
}

export interface DoctorInput {
  /** Apply every available fix. */
  fix?: boolean;
}

/**
 * Checks that the files in `.rowbly/` line up with its config: every stage has a file and every
 * file a stage, every story has a title, a known stage and exactly the project's custom fields, and
 * every spec has a title and links to Stories that exist. A spec with no Story is an orphan: a warning.
 * Every skill in the config must be installed for each of its harnesses.
 */
export async function doctor(input: DoctorInput = {}, ctx: ServiceContext = {}): Promise<DoctorReport> {
  const paths = await findProject(ctx);
  const fix = input.fix ?? false;
  const issues: DoctorIssue[] = [];
  const rel = (path: string) => relative(paths.root, path);
  /** Records an issue; when fixing and a fix exists, runs it first. */
  const report = async (issue: Omit<DoctorIssue, "fixed">, apply?: () => void | Promise<void>) => {
    const fixed = fix && apply !== undefined;
    if (fixed) await apply();
    issues.push({ ...issue, fixed });
  };

  const parsed = parseConfig(await readFile(paths.configFile, "utf8"));
  if (!parsed.config) {
    for (const issue of parsed.issues) {
      const where = issue.path.length > 0 ? `${issue.path.join(".")}: ` : "";
      await report({ severity: "error", message: `${where}${issue.message}`, file: rel(paths.configFile) });
    }
    return { root: paths.root, issues, ok: false };
  }
  const config = parsed.config;

  for (const dir of [paths.stagesDir, paths.storiesDir]) {
    if (!(await pathExists(dir))) {
      await report({ severity: "error", message: "Folder is missing", file: rel(dir), fix: "Create it" }, () =>
        mkdir(dir, { recursive: true }).then(() => undefined),
      );
    }
  }

  await checkStages(paths, config, rel, report);
  await checkStories(paths, config, rel, report);
  await checkSpecs(paths, config, rel, report);
  await checkSkills(paths, config, ctx, rel, report);

  return { root: paths.root, issues, ok: !issues.some((issue) => issue.severity === "error" && !issue.fixed) };
}

type Report = (issue: Omit<DoctorIssue, "fixed">, apply?: () => void | Promise<void>) => Promise<void>;

async function checkStages(
  paths: ProjectPaths,
  config: ProjectConfig,
  rel: (path: string) => string,
  report: Report,
): Promise<void> {
  const files = await listMarkdownFiles(paths.stagesDir);
  for (const stage of config.stages) {
    const file = join(paths.stagesDir, `${stage.key}.md`);
    if (!files.includes(`${stage.key}.md`)) {
      await report(
        { severity: "error", message: `Stage ${stage.key} has no file`, file: rel(file), fix: "Create an empty one" },
        () => writeFile(file, ""),
      );
    }
  }
  let changedConfig = false;
  for (const name of files) {
    const key = name.slice(0, -3);
    if (config.stages.some((stage) => stage.key === key)) continue;
    const file = rel(join(paths.stagesDir, name));
    if (!STAGE_KEY_PATTERN.test(key)) {
      await report({
        severity: "error",
        message: `"${key}" is not a valid stage key (UPPER_SNAKE_CASE)`,
        file,
      });
      continue;
    }
    await report(
      { severity: "error", message: `Stage ${key} is not in the config`, file, fix: "Add it to the config" },
      () => {
        config.stages.push({ key, label: labelFromKey(key), enabled: true });
        changedConfig = true;
      },
    );
  }
  if (changedConfig) await writeConfig(paths, config);
}

async function checkStories(
  paths: ProjectPaths,
  config: ProjectConfig,
  rel: (path: string) => string,
  report: Report,
): Promise<void> {
  const numbers = new Map<number, string>();
  for (const name of await listMarkdownFiles(paths.storiesDir)) {
    const path = join(paths.storiesDir, name);
    const file = rel(path);
    const parsedName = parseStoryFileName(name);
    if (!parsedName) {
      await report({
        severity: "error",
        message: `File name should be ${config.projectKey}-<number>.md`,
        file,
      });
      continue;
    }
    if (parsedName.projectKey !== config.projectKey) {
      await report({
        severity: "error",
        message: `Story key ${parsedName.projectKey} does not match the project key ${config.projectKey}`,
        file,
      });
    }
    const other = numbers.get(parsedName.number);
    if (other) {
      await report({ severity: "error", message: `Story number ${parsedName.number} is also used by ${other}`, file });
    }
    numbers.set(parsedName.number, name);

    let story: StoryFile;
    try {
      story = { id: name.slice(0, -3), ...parsedName, path, doc: parseMarkdown(await readFile(path, "utf8"), file) };
    } catch (error) {
      if (!(error instanceof RowblyError)) throw error;
      const reason = error.details.reason;
      await report({ severity: "error", message: `Invalid frontmatter: ${reason ?? error.message}`, file });
      continue;
    }
    await checkStory(config, story, file, report);
  }
}

async function checkStory(config: ProjectConfig, story: StoryFile, file: string, report: Report): Promise<void> {
  const data = story.doc.data;
  let changed = false;
  const change = (apply: () => void) => () => {
    apply();
    changed = true;
  };

  if (typeof data.title !== "string" || data.title.trim() === "") {
    await report({ severity: "error", message: "Title is missing", file });
  }

  const firstStage = config.stages.find((stage) => stage.enabled) ?? config.stages[0];
  if (data.stage === undefined || data.stage === null || data.stage === "") {
    await report(
      { severity: "error", message: "Stage is missing", file, fix: `Put it in ${firstStage?.key}` },
      change(() => {
        data.stage = firstStage?.key;
      }),
    );
  } else {
    const exact = config.stages.find((stage) => stage.key === data.stage);
    const loose = config.stages.find((stage) => stage.key === String(data.stage).trim().toUpperCase());
    if (!exact && loose) {
      await report(
        { severity: "error", message: `Stage "${String(data.stage)}" should be ${loose.key}`, file, fix: "Correct it" },
        change(() => {
          data.stage = loose.key;
        }),
      );
    } else if (!exact) {
      await report({
        severity: "error",
        message: `Unknown stage "${String(data.stage)}". Stages: ${config.stages.map((s) => s.key).join(", ")}`,
        file,
      });
    } else if (!exact.enabled) {
      await report({ severity: "warning", message: `Stage ${exact.key} is disabled`, file });
    }
  }

  for (const field of config.customFields) {
    if (!(field.key in data)) {
      await report(
        { severity: "error", message: `Custom field "${field.key}" is missing`, file, fix: "Add it with no value" },
        change(() => {
          data[field.key] = null;
        }),
      );
      continue;
    }
    const error = fieldValueError(field, data[field.key]);
    if (!error) continue;
    const coerced = coerceFieldValue(
      field,
      typeof data[field.key] === "string" ? data[field.key] : String(data[field.key]),
    );
    if (coerced.ok) {
      await report(
        { severity: "error", message: error, file, fix: `Change it to ${JSON.stringify(coerced.value)}` },
        change(() => {
          data[field.key] = coerced.value;
        }),
      );
    } else {
      await report({ severity: "error", message: error, file });
    }
  }

  if ("agentLock" in data) {
    const lock = parseAgentLock(data.agentLock);
    if (!lock) {
      await report({ severity: "error", message: "agentLock must have agent, stage and an ISO-8601 lockedAt", file });
    } else if (
      lock.stage !==
      String(data.stage ?? "")
        .trim()
        .toUpperCase()
    ) {
      await report(
        { severity: "warning", message: `Stale agent lock from Stage ${lock.stage}`, file, fix: "Remove it" },
        change(() => {
          delete data.agentLock;
        }),
      );
    }
  }

  const known = new Set(["title", "stage", "position", "agentLock", ...config.customFields.map((field) => field.key)]);
  for (const key of Object.keys(data)) {
    if (known.has(key)) continue;
    await report(
      { severity: "error", message: `"${key}" is not a custom field of this project`, file, fix: "Remove it" },
      change(() => {
        delete data[key];
      }),
    );
  }

  if (changed) await writeStoryFile(config, story.path, story.doc);
}

async function checkSpecs(
  paths: ProjectPaths,
  config: ProjectConfig,
  rel: (path: string) => string,
  report: Report,
): Promise<void> {
  const storyIds = new Set(
    (await listMarkdownFiles(paths.storiesDir)).flatMap((name) => {
      const parsed = parseStoryFileName(name);
      return parsed?.projectKey === config.projectKey ? [formatStoryId(parsed.projectKey, parsed.number)] : [];
    }),
  );
  for (const name of await listMarkdownFiles(paths.specsDir)) {
    const path = join(paths.specsDir, name);
    const file = rel(path);
    const slug = name.slice(0, -3);
    if (!SPEC_SLUG_PATTERN.test(slug)) {
      await report({
        severity: "error",
        message: `"${slug}" is not a valid spec slug (lowercase letters and digits, with - between words)`,
        file,
      });
      continue;
    }
    let doc: MarkdownDocument;
    try {
      doc = parseMarkdown(await readFile(path, "utf8"), file);
    } catch (error) {
      if (!(error instanceof RowblyError)) throw error;
      const reason = error.details.reason;
      await report({ severity: "error", message: `Invalid frontmatter: ${reason ?? error.message}`, file });
      continue;
    }
    await checkSpec(config.projectKey, storyIds, { slug, path, doc }, file, report);
  }
}

async function checkSpec(
  projectKey: string,
  storyIds: ReadonlySet<string>,
  spec: SpecFile,
  file: string,
  report: Report,
): Promise<void> {
  const data = spec.doc.data;
  let changed = false;
  const change = (apply: () => void) => () => {
    apply();
    changed = true;
  };

  if (typeof data.title !== "string" || data.title.trim() === "") {
    const title = labelFromSlug(spec.slug);
    await report(
      { severity: "error", message: "Title is missing", file, fix: `Set it to "${title}"` },
      change(() => {
        data.title = title;
      }),
    );
  }

  let stories: unknown[] = [];
  if (Array.isArray(data.stories)) stories = data.stories;
  else if (data.stories === undefined || data.stories === null) {
    await report(
      { severity: "error", message: "stories is missing", file, fix: "Add an empty list" },
      change(() => {
        data.stories = [];
      }),
    );
  } else if (typeof data.stories === "string" || typeof data.stories === "number") {
    stories = [data.stories];
    await report(
      { severity: "error", message: "stories must be a list of Story IDs", file, fix: "Make it a list" },
      change(() => {
        data.stories = stories;
      }),
    );
  } else {
    await report({ severity: "error", message: "stories must be a list of Story IDs", file });
  }

  const kept: string[] = [];
  for (const value of stories) {
    const id = canonicalStoryId(projectKey, value);
    if (id === undefined) {
      await report(
        { severity: "error", message: `"${String(value)}" is not a Story ID of this project`, file, fix: "Remove it" },
        change(() => {
          data.stories = (data.stories as unknown[]).filter((v) => v !== value);
        }),
      );
    } else if (!storyIds.has(id)) {
      await report(
        { severity: "warning", message: `Links to ${id}, which does not exist`, file, fix: "Remove the link" },
        change(() => {
          data.stories = (data.stories as unknown[]).filter((v) => v !== value);
        }),
      );
    } else if (kept.includes(id)) {
      await report(
        { severity: "warning", message: `Links to ${id} more than one time`, file, fix: "Remove the repeat" },
        change(() => {
          const list = data.stories as unknown[];
          list.splice(list.lastIndexOf(value), 1);
        }),
      );
    } else {
      kept.push(id);
      if (value !== id) {
        await report(
          { severity: "error", message: `Story ID "${String(value)}" should be ${id}`, file, fix: "Correct it" },
          change(() => {
            data.stories = (data.stories as unknown[]).map((v) => (v === value ? id : v));
          }),
        );
      }
    }
  }
  if (kept.length === 0) {
    await report({ severity: "warning", message: "Orphan spec: it is not linked to a Story", file });
  }

  for (const key of Object.keys(data)) {
    if (SPEC_KEYS.includes(key)) continue;
    await report(
      { severity: "error", message: `"${key}" is not a spec key (title, stories)`, file, fix: "Remove it" },
      change(() => {
        delete data[key];
      }),
    );
  }

  if (changed) await writeSpecFile(spec.path, spec.doc);
}

/** `--fix` copies a skill only into an empty place: a folder that lacks `SKILL.md` can hold the work of a user. */
async function checkSkills(
  paths: ProjectPaths,
  config: ProjectConfig,
  ctx: ServiceContext,
  rel: (path: string) => string,
  report: Report,
): Promise<void> {
  if (!config.skills?.length) return;
  const bundled = await bundledSkills(ctx);
  for (const { name, harnesses } of config.skills) {
    for (const harness of harnesses) {
      const path = skillPath(paths, harness, name);
      if (await pathExists(join(path, SKILL_FILE))) continue;
      const file = rel(path);
      const remove = `\`rowbly remove-skill ${name} --harness ${harness}\``;
      if (await pathOccupied(path)) {
        await report({
          severity: "error",
          message: `Skill ${name} for ${harness} has no ${SKILL_FILE}. Repair the folder by hand, or delete it with ${remove}`,
          file,
        });
      } else if (!bundled.names.includes(name)) {
        await report({
          severity: "error",
          message: `Skill ${name} for ${harness} is missing, and Rowbly no longer bundles it. Run ${remove}`,
          file,
        });
      } else {
        await report(
          { severity: "error", message: `Skill ${name} for ${harness} is missing`, file, fix: "Install it again" },
          async () => {
            await copySkill(join(bundled.dir, name), path);
          },
        );
      }
    }
  }
}

/** `"login-page"` → `"Login page"`. */
function labelFromSlug(slug: string): string {
  const text = slug.replace(/-/g, " ");
  return text.charAt(0).toUpperCase() + text.slice(1);
}
