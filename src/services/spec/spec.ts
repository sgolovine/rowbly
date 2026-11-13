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

/** A Story ID that resolves to an existing Story, or the issue when no Story has the ID. */
type StoryLookup = { readonly id: string } | { readonly issue: Issue };

/** The IDs of the linked Stories as the files name them, and an issue for each ID that is not a Story. */
interface ResolvedStories {
  readonly ids: string[];
  readonly issues: Issue[];
}

/** Finds the project and its config. Throws unless the Specs feature is on. */
async function open(ctx: ServiceContext): Promise<{ paths: ProjectPaths; config: ProjectConfig }> {
  const paths = await findProject(ctx);
  const config = await readConfig(paths);

  requireSpecs(config);

  return { paths, config };
}

function specFileIssues(data: Record<string, unknown>): Issue[] {
  const title =
    typeof data.title !== "string" || data.title.trim() === ""
      ? [{ path: ["title"], message: "Title is required" }]
      : [];
  const stories = Array.isArray(data.stories)
    ? []
    : [{ path: ["stories"], message: "stories must be a list of Story IDs" }];

  return [...title, ...stories];
}

/** Checks a spec file and returns it as a `Spec`. */
function toSpec(config: ProjectConfig, file: SpecFile): Spec {
  const { data, body } = file.doc;
  const issues = specFileIssues(data);
  const stories: unknown[] = Array.isArray(data.stories) ? data.stories : [];

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

function titleIssues(title: string): Issue[] {
  return title.trim() === "" ? [{ path: ["title"], message: "Title is required" }] : [];
}

async function lookupStory(id: string, ctx: ServiceContext): Promise<StoryLookup> {
  try {
    return { id: (await getStory({ id }, ctx)).id };
  } catch (error) {
    if (!(error instanceof NotFoundError)) {
      throw error;
    }

    return { issue: { path: ["stories"], message: `Story ${id} not found` } };
  }
}

/** The IDs of `stories` as the files name them, without repeats. Each one must be an existing Story. */
async function resolveStories(stories: readonly string[], ctx: ServiceContext): Promise<ResolvedStories> {
  const empty =
    stories.length === 0 ? [{ path: ["stories"], message: "A spec must be linked to at least one Story" }] : [];
  // Each lookup waits for the previous one, so the Stories are read one at a time, in order. The list comes from
  // the input of a person, so it is short.
  const lookups = await stories.reduce<Promise<readonly StoryLookup[]>>(
    async (previous, id) => [...(await previous), await lookupStory(id, ctx)],
    Promise.resolve([]),
  );

  return {
    ids: [...new Set(lookups.flatMap((lookup) => ("id" in lookup ? [lookup.id] : [])))],
    issues: [...empty, ...lookups.flatMap((lookup) => ("issue" in lookup ? [lookup.issue] : []))],
  };
}

/** The base slug, or the base with the first number from 2 that no spec uses. */
async function freeSlug(paths: ProjectPaths, base: string, number: number): Promise<string> {
  const slug = number === 1 ? base : `${base}-${number}`;

  return (await pathExists(specPath(paths, slug))) ? freeSlug(paths, base, number + 1) : slug;
}

/** The slug of a new spec, and an issue when the input slug is not valid. Throws when a spec has the slug. */
async function newSlug(
  paths: ProjectPaths,
  input: CreateSpecInput,
  title: string,
): Promise<{ slug: string; issues: Issue[] }> {
  if (input.slug === undefined) {
    return { slug: await freeSlug(paths, toSpecSlug(title) || "spec", 1), issues: [] };
  }

  const slug = input.slug.trim().toLowerCase();

  if (!SPEC_SLUG_PATTERN.test(slug)) {
    return {
      slug,
      issues: [
        { path: ["slug"], message: `Slug "${input.slug}" must be lowercase letters and digits, with - between words` },
      ],
    };
  }

  if (await pathExists(specPath(paths, slug))) {
    throw new ConflictError(`Spec ${slug} already exists`, { hint: "Use another --slug, or `rowbly spec update`." });
  }

  return { slug, issues: [] };
}

/** Creates a spec linked to existing Stories. Without a slug, the title gives one that no spec uses. */
export async function createSpec(input: CreateSpecInput, ctx: ServiceContext = {}): Promise<Spec> {
  const { paths, config } = await open(ctx);
  const title = input.title.trim();
  const slug = await newSlug(paths, input, title);
  const stories = await resolveStories(input.stories, ctx);
  const issues = [...titleIssues(input.title), ...slug.issues, ...stories.issues];

  throwIfIssues(invalidMessage(issues), issues);

  await writeSpecFile(specPath(paths, slug.slug), { data: { title, stories: stories.ids }, body: input.body ?? "" });

  return toSpec(config, await readSpecFile(paths, slug.slug));
}

/** Gives the spec with the slug, ignoring case. */
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

/** Changes the title, the body or the links of a spec. */
export async function updateSpec(input: UpdateSpecInput, ctx: ServiceContext = {}): Promise<Spec> {
  const { paths, config } = await open(ctx);
  const file = await findSpecFile(paths, input.slug);

  toSpec(config, file);

  const stories = input.stories === undefined ? undefined : await resolveStories(input.stories, ctx);
  const issues = [...(input.title === undefined ? [] : titleIssues(input.title)), ...(stories?.issues ?? [])];

  throwIfIssues(invalidMessage(issues), issues);

  const data = {
    ...file.doc.data,
    ...(input.title === undefined ? {} : { title: input.title.trim() }),
    ...(stories === undefined ? {} : { stories: stories.ids }),
  };
  const doc = { data, body: input.body ?? file.doc.body };

  await writeSpecFile(file.path, doc);

  return toSpec(config, { ...file, doc });
}

/** Deletes the spec file. */
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
