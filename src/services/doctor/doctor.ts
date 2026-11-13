import { execFile } from "node:child_process";
import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join, relative } from "node:path";
import { promisify } from "node:util";
import {
  attachmentDir,
  attachmentOwners,
  noSymlink,
  readAttachments,
  writeAttachments,
} from "../attachment-files/attachment-files.js";
import { labelFromKey, type ProjectConfig, parseConfig, STAGE_KEY_PATTERN, writeConfig } from "../config/config.js";
import { RowblyError } from "../errors/errors.js";
import { coerceFieldValue, fieldValueError } from "../fields/fields.js";
import { canCreateFolder, listMarkdownFiles, pathExists, pathOccupied } from "../files/files.js";
import { type MarkdownDocument, parseMarkdown } from "../markdown/markdown.js";
import { ensureRuntimeIgnores, missingRuntimeIgnores } from "../runtime-files/runtime-files.js";
import { bundledSkills, copySkill, SKILL_FILE, skillPath } from "../skill/skill.js";
import {
  canonicalStoryId,
  SPEC_KEYS,
  SPEC_SLUG_PATTERN,
  type SpecFile,
  writeSpecFile,
} from "../spec-files/spec-files.js";
import { formatStoryId, parseStoryFileName, type StoryFile, writeStoryFile } from "../story-files/story-files.js";
import { listThreads } from "../thread/thread.js";
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
    if (fixed) {
      await apply();
    }
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

  const missingIgnores = await missingRuntimeIgnores(paths);
  if (missingIgnores.length) {
    await report(
      {
        severity: "warning",
        message: "Factory runtime ignore rules are missing",
        file: rel(paths.ignoreFile),
        fix: "Add the missing rules",
      },
      () => ensureRuntimeIgnores(paths),
    );
  }
  const tracked = await promisify(execFile)(
    "git",
    ["-C", paths.root, "ls-files", "-z", "--", ".rowbly/runtime", ".rowbly/state.json*"],
    { encoding: "utf8" },
  ).then(
    (result) => result.stdout.split("\0").filter(Boolean),
    () => [],
  );
  for (const file of tracked) {
    await report({ severity: "warning", message: "Factory runtime file is tracked by Git", file });
  }

  const threads = await listThreads({}, ctx);
  for (const issue of threads.issues) {
    await report({ severity: "warning", message: issue.message, file: `.rowbly/runtime/${issue.file}` });
  }
  for (const thread of threads.threads) {
    if (thread.storyId && !(await pathExists(join(paths.storiesDir, `${thread.storyId}.md`)))) {
      await report({
        severity: "warning",
        message: `Thread ${thread.id} links to a Story that does not exist`,
        file: `.rowbly/runtime/threads/${thread.id}.json`,
      });
    }
  }
  await checkStages(paths, config, rel, report);
  await checkStories(paths, config, rel, report);
  await checkSpecs(paths, config, rel, report);
  await checkSkills(paths, config, ctx, rel, report);
  await checkAttachments(paths, rel, report);

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
    if (config.stages.some((stage) => stage.key === key)) {
      continue;
    }
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
  if (changedConfig) {
    await writeConfig(paths, config);
  }
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
      if (!(error instanceof RowblyError)) {
        throw error;
      }
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
    if (!error) {
      continue;
    }
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

  // Rowbly once wrote agent locks to Story files. The factory state file now records agent activity.
  if ("agentLock" in data) {
    await report(
      { severity: "warning", message: "agentLock is no longer used", file, fix: "Remove it" },
      change(() => {
        delete data.agentLock;
      }),
    );
  }

  const known = new Set(["title", "stage", "position", "agentLock", ...config.customFields.map((field) => field.key)]);
  for (const key of Object.keys(data)) {
    if (known.has(key)) {
      continue;
    }
    await report(
      { severity: "error", message: `"${key}" is not a custom field of this project`, file, fix: "Remove it" },
      change(() => {
        delete data[key];
      }),
    );
  }

  if (changed) {
    await writeStoryFile(config, story.path, story.doc);
  }
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
      if (!(error instanceof RowblyError)) {
        throw error;
      }
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
  if (Array.isArray(data.stories)) {
    stories = data.stories;
  } else if (data.stories === undefined || data.stories === null) {
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
    if (SPEC_KEYS.includes(key)) {
      continue;
    }
    await report(
      { severity: "error", message: `"${key}" is not a spec key (title, stories)`, file, fix: "Remove it" },
      change(() => {
        delete data[key];
      }),
    );
  }

  if (changed) {
    await writeSpecFile(spec.path, spec.doc);
  }
}

/** `--fix` copies a skill only into an empty place: a folder that lacks `SKILL.md` can hold the work of a user. */
async function checkSkills(
  paths: ProjectPaths,
  config: ProjectConfig,
  ctx: ServiceContext,
  rel: (path: string) => string,
  report: Report,
): Promise<void> {
  if (!config.skills?.length) {
    return;
  }
  const bundled = await bundledSkills(ctx);
  for (const { name, harnesses } of config.skills) {
    for (const harness of harnesses) {
      const path = skillPath(paths, harness, name);
      if (await pathExists(join(path, SKILL_FILE))) {
        continue;
      }
      const file = rel(path);
      const remove = `\`rowbly skill remove ${name} --harness ${harness}\``;
      if (!(await canCreateFolder(dirname(path)))) {
        await report({
          severity: "error",
          message: `Skill ${name} for ${harness} is missing, and Rowbly cannot create ${rel(dirname(path))}. Repair that path, or run ${remove}`,
          file,
        });
      } else if (await pathOccupied(path)) {
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

async function checkAttachments(paths: ProjectPaths, rel: (path: string) => string, report: Report): Promise<void> {
  let owners: string[];
  try {
    owners = await attachmentOwners(paths);
  } catch (err) {
    await report({ severity: "error", message: String(err), file: rel(join(paths.dir, "attachments")) });
    return;
  }
  for (const owner of owners) {
    const file = join(paths.dir, "attachments", owner, "manifest.json");
    try {
      const dir = await attachmentDir(paths, owner);
      const records = await readAttachments(dir);
      const kept: typeof records = [];
      const owned = await pathExists(join(paths.storiesDir, `${owner}.md`));
      for (const a of records) {
        const png = join(dir, `${a.id}.png`);
        await noSymlink(png);
        if (await pathExists(png)) {
          kept.push(a);
        } else {
          await report(
            {
              severity: "error",
              message: `Attachment ${a.name} has no PNG`,
              file: rel(png),
              fix: "Remove the missing-file reference",
            },
            () =>
              writeAttachments(
                dir,
                records.filter((entry) => entry.id !== a.id),
              ),
          );
        }
      }
      // Write the combined repair, so multiple missing files are removed together.
      if (kept.length !== records.length) {
        await report(
          {
            severity: "warning",
            message: "Attachment metadata references missing PNGs",
            file: rel(file),
            fix: "Remove missing-file references",
          },
          () => writeAttachments(dir, kept),
        );
      }
      for (const name of await readdir(dir)) {
        if (name.endsWith(".png") && (!owned || !records.some((a) => `${a.id}.png` === name))) {
          await report({
            severity: "warning",
            message: "Orphan PNG: preserve it for recovery",
            file: rel(join(dir, name)),
          });
        }
      }
    } catch (err) {
      await report({
        severity: "error",
        message: `Malformed attachment metadata: ${err instanceof Error ? err.message : String(err)}`,
        file: rel(file),
      });
    }
  }
}
