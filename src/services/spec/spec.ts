import { rm } from "node:fs/promises";
import { featureEnabled, type Issue, type ProjectConfig, readConfig, throwIfIssues } from "../config/config.js";
import { ConflictError, NotFoundError, ValidationError } from "../errors/errors.js";
import { pathExists } from "../files/files.js";
import {
  canonicalStoryId,
  readSpecFile,
  readSpecFiles,
  SPEC_SLUG_PATTERN,
  type SpecFile,
  specPath,
  toSpecSlug,
  writeSpecFile,
} from "../spec-files/spec-files.js";
import { getStory } from "../story/story.js";
import { findProject, type ProjectPaths, type ServiceContext } from "../workspace/workspace.js";

/** A Markdown document that describes the work of the Stories it is linked to. */
export interface Spec {
  /** From the file name: `login-page` in `specs/login-page.md`. */
  slug: string;
  title: string;
  /** The IDs of the linked Stories. A spec always has at least one. */
  stories: string[];
  /** The Markdown body. */
  body: string;
  path: string;
}

export interface CreateSpecInput {
  title: string;
  /** Defaults to the title in kebab-case, with a number added when that slug is taken. */
  slug?: string;
  /** The Stories to link, at least one. */
  stories: string[];
  body?: string;
}

export interface UpdateSpecInput {
  slug: string;
  title?: string;
  body?: string;
  /** Replaces every link. At least one Story. */
  stories?: string[];
}

export interface ListSpecsInput {
  /** Only the specs linked to this Story. */
  story?: string;
}

export interface SpecLinkInput {
  slug: string;
  story: string;
}

const INVALID_SPEC_HINT = "Run `rowbly doctor` to find and fix problems in spec files.";

/** Throws unless the project has the Specs feature on. */
function requireSpecs(config: ProjectConfig): void {
  if (!featureEnabled(config, "specs")) {
    throw new ConflictError("Specs are turned off in this project", {
      hint: "Run `rowbly project update --specs on`, or turn Specs on in the TUI Settings.",
    });
  }
}

async function open(ctx: ServiceContext): Promise<{ paths: ProjectPaths; config: ProjectConfig }> {
  const paths = await findProject(ctx);
  const config = await readConfig(paths);
  requireSpecs(config);
  return { paths, config };
}

/** Checks a spec file and returns it as a `Spec`. */
function toSpec(config: ProjectConfig, file: SpecFile): Spec {
  const { data, body } = file.doc;
  const issues: Issue[] = [];
  if (typeof data.title !== "string" || data.title.trim() === "") {
    issues.push({ path: ["title"], message: "Title is required" });
  }
  const stories = Array.isArray(data.stories) ? data.stories : [];
  if (!Array.isArray(data.stories)) {
    issues.push({ path: ["stories"], message: "stories must be a list of Story IDs" });
  }
  throwIfIssues(
    `Spec ${file.slug} is invalid: ${issues.map((issue) => issue.message).join("; ")}`,
    issues,
    INVALID_SPEC_HINT,
  );
  return {
    slug: file.slug,
    title: data.title as string,
    stories: stories.map((id) => canonicalStoryId(config.projectKey, id) ?? String(id)),
    body,
    path: file.path,
  };
}

async function findSpecFile(paths: ProjectPaths, slug: string): Promise<SpecFile> {
  const key = slug.trim().toLowerCase();
  if (!SPEC_SLUG_PATTERN.test(key) || !(await pathExists(specPath(paths, key)))) {
    throw new NotFoundError(`Spec ${slug} not found`, { hint: "Run `rowbly spec list` to see the specs." });
  }
  return readSpecFile(paths, key);
}

function invalidMessage(issues: readonly Issue[]): string {
  return `The spec is invalid: ${issues.map((issue) => issue.message).join("; ")}`;
}

function checkTitle(title: string, issues: Issue[]): string {
  if (title.trim() === "") {
    issues.push({ path: ["title"], message: "Title is required" });
  }
  return title.trim();
}

/** The IDs of `stories` as the files name them, without repeats. Each one must be an existing Story. */
async function resolveStories(stories: readonly string[], ctx: ServiceContext, issues: Issue[]): Promise<string[]> {
  if (stories.length === 0) {
    issues.push({ path: ["stories"], message: "A spec must be linked to at least one Story" });
  }
  const ids: string[] = [];
  for (const id of stories) {
    try {
      const story = await getStory({ id }, ctx);
      if (!ids.includes(story.id)) {
        ids.push(story.id);
      }
    } catch (error) {
      if (!(error instanceof NotFoundError)) {
        throw error;
      }
      issues.push({ path: ["stories"], message: `Story ${id} not found` });
    }
  }
  return ids;
}

export async function createSpec(input: CreateSpecInput, ctx: ServiceContext = {}): Promise<Spec> {
  const { paths, config } = await open(ctx);
  const issues: Issue[] = [];
  const title = checkTitle(input.title, issues);
  let slug: string;
  if (input.slug !== undefined) {
    slug = input.slug.trim().toLowerCase();
    if (!SPEC_SLUG_PATTERN.test(slug)) {
      issues.push({
        path: ["slug"],
        message: `Slug "${input.slug}" must be lowercase letters and digits, with - between words`,
      });
    } else if (await pathExists(specPath(paths, slug))) {
      throw new ConflictError(`Spec ${slug} already exists`, { hint: "Use another --slug, or `rowbly spec update`." });
    }
  } else {
    const base = toSpecSlug(title) || "spec";
    slug = base;
    for (let n = 2; await pathExists(specPath(paths, slug)); n++) {
      slug = `${base}-${n}`;
    }
  }
  const stories = await resolveStories(input.stories, ctx, issues);
  throwIfIssues(invalidMessage(issues), issues);

  const path = specPath(paths, slug);
  await writeSpecFile(path, { data: { title, stories }, body: input.body ?? "" });
  return toSpec(config, await readSpecFile(paths, slug));
}

export async function getSpec(input: { slug: string }, ctx: ServiceContext = {}): Promise<Spec> {
  const { paths, config } = await open(ctx);
  return toSpec(config, await findSpecFile(paths, input.slug));
}

/** Every spec, by slug. With `story`, only the specs linked to that Story. */
export async function listSpecs(input: ListSpecsInput = {}, ctx: ServiceContext = {}): Promise<Spec[]> {
  const { paths, config } = await open(ctx);
  const story = input.story === undefined ? undefined : (await getStory({ id: input.story }, ctx)).id;
  const specs = (await readSpecFiles(paths)).map((file) => toSpec(config, file));
  return story === undefined ? specs : specs.filter((spec) => spec.stories.includes(story));
}

export async function updateSpec(input: UpdateSpecInput, ctx: ServiceContext = {}): Promise<Spec> {
  const { paths, config } = await open(ctx);
  const file = await findSpecFile(paths, input.slug);
  toSpec(config, file);
  const data = { ...file.doc.data };
  const issues: Issue[] = [];
  if (input.title !== undefined) {
    data.title = checkTitle(input.title, issues);
  }
  if (input.stories !== undefined) {
    data.stories = await resolveStories(input.stories, ctx, issues);
  }
  throwIfIssues(invalidMessage(issues), issues);
  const doc = { data, body: input.body ?? file.doc.body };
  await writeSpecFile(file.path, doc);
  return toSpec(config, { ...file, doc });
}

export async function deleteSpec(input: { slug: string }, ctx: ServiceContext = {}): Promise<{ slug: string }> {
  const { paths } = await open(ctx);
  const file = await findSpecFile(paths, input.slug);
  await rm(file.path);
  return { slug: file.slug };
}

/** Links the spec to one more Story. A link that exists already is not an error. */
export async function linkSpec(input: SpecLinkInput, ctx: ServiceContext = {}): Promise<Spec> {
  const spec = await getSpec({ slug: input.slug }, ctx);
  return updateSpec({ slug: spec.slug, stories: [...spec.stories, input.story] }, ctx);
}

/** Removes the link from the spec to a Story. The last link cannot be removed: delete the spec. */
export async function unlinkSpec(input: SpecLinkInput, ctx: ServiceContext = {}): Promise<Spec> {
  const spec = await getSpec({ slug: input.slug }, ctx);
  const paths = await findProject(ctx);
  const config = await readConfig(paths);
  const id = canonicalStoryId(config.projectKey, input.story);
  if (id === undefined || !spec.stories.includes(id)) {
    throw new NotFoundError(`Spec ${spec.slug} is not linked to ${input.story}`);
  }
  const stories = spec.stories.filter((story) => story !== id);
  if (stories.length === 0) {
    throw new ValidationError(`${id} is the only Story of spec ${spec.slug}`, {
      details: { issues: [{ path: ["stories"], message: "A spec must be linked to at least one Story" }] },
      hint: `Link it to another Story first, or run \`rowbly spec delete ${spec.slug}\`.`,
    });
  }
  return updateSpec({ slug: spec.slug, stories }, ctx);
}
