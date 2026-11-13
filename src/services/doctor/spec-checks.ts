import { readFile } from "node:fs/promises";
import { join } from "node:path";
import type { ProjectConfig } from "../config/config.js";
import { RowblyError } from "../errors/errors.js";
import { listMarkdownFiles } from "../files/files.js";
import { type MarkdownDocument, parseMarkdown } from "../markdown/markdown.js";
import { SPEC_KEYS, SPEC_SLUG_PATTERN, type SpecFile, writeSpecFile } from "../spec-files/spec-files.js";
import { Store } from "../store/store.js";
import { formatStoryId, parseStoryFileName } from "../story-files/story-files.js";
import {
  type DoctorIssue,
  type DoctorRun,
  frontmatterIssue,
  noted,
  rel,
  reportChange,
  withoutKey,
} from "./doctor-run.js";
import { mapInOrder } from "./map-in-order.js";
import { type SpecCheck, type SpecRepair, walkLinks } from "./spec-link-checks.js";

type SpecRead = { readonly doc: MarkdownDocument } | { readonly issue: DoctorIssue };

/** `"login-page"` → `"Login page"`. */
function labelFromSlug(slug: string): string {
  const text = slug.replace(/-/g, " ");

  return text.charAt(0).toUpperCase() + text.slice(1);
}

function storyIdOf(projectKey: string, name: string): string[] {
  const parsed = parseStoryFileName(name);

  return parsed?.projectKey === projectKey ? [formatStoryId(parsed.projectKey, parsed.number)] : [];
}

/** The list that the link check walks. A single ID becomes a list of one. */
function linkSource(stories: unknown): readonly unknown[] {
  if (Array.isArray(stories)) {
    return stories;
  }

  return typeof stories === "string" || typeof stories === "number" ? [stories] : [];
}

async function titleIssues(run: DoctorRun, spec: SpecFile, repair: Store<SpecRepair>, file: string) {
  const { data } = repair.current;

  if (typeof data.title === "string" && data.title.trim() !== "") {
    return [];
  }

  const title = labelFromSlug(spec.slug);

  return [
    await reportChange(
      run,
      repair,
      { severity: "error", message: "Title is missing", file, fix: `Set it to "${title}"` },
      (state) => ({ data: { ...state.data, title } }),
    ),
  ];
}

/** `stories` must be a list. A single ID becomes a list of one, and the list then is the walked list. */
async function storiesShapeIssues(run: DoctorRun, repair: Store<SpecRepair>, file: string): Promise<DoctorIssue[]> {
  const { stories } = repair.current.data;

  if (Array.isArray(stories)) {
    return [];
  }

  if (stories === undefined || stories === null) {
    return [
      await reportChange(
        run,
        repair,
        { severity: "error", message: "stories is missing", file, fix: "Add an empty list" },
        (state) => ({ data: { ...state.data, stories: [] } }),
      ),
    ];
  }

  if (typeof stories === "string" || typeof stories === "number") {
    return [
      await reportChange(
        run,
        repair,
        { severity: "error", message: "stories must be a list of Story IDs", file, fix: "Make it a list" },
        (state) => ({ data: { ...state.data, stories: state.source }, aliased: true }),
      ),
    ];
  }

  return [noted({ severity: "error", message: "stories must be a list of Story IDs", file })];
}

function unknownKeyIssue(run: DoctorRun, repair: Store<SpecRepair>, key: string, file: string): Promise<DoctorIssue> {
  return reportChange(
    run,
    repair,
    { severity: "error", message: `"${key}" is not a spec key (title, stories)`, file, fix: "Remove it" },
    (state) => ({ data: withoutKey(state.data, key) }),
  );
}

/** Checks one spec in order. Each check reads the frontmatter after the fixes of the checks before it. */
async function checkSpec(run: DoctorRun, check: SpecCheck, spec: SpecFile): Promise<DoctorIssue[]> {
  const { data } = spec.doc;
  const { file } = check;
  const repair = new Store<SpecRepair>({
    data,
    changed: false,
    source: linkSource(data.stories),
    aliased: Array.isArray(data.stories),
    kept: [],
  });

  const shapeIssues = [
    ...(await titleIssues(run, spec, repair, file)),
    ...(await storiesShapeIssues(run, repair, file)),
  ];
  const linkIssues = await walkLinks(run, check, repair, 0);
  const orphan =
    repair.current.kept.length === 0
      ? [noted({ severity: "warning", message: "Orphan spec: it is not linked to a Story", file })]
      : [];
  const unknown = Object.keys(repair.current.data).filter((key) => !SPEC_KEYS.includes(key));
  const keyIssues = await mapInOrder(unknown, (key) => unknownKeyIssue(run, repair, key, file));

  if (repair.current.changed) {
    await writeSpecFile(spec.path, { ...spec.doc, data: { ...repair.current.data } });
  }

  return [...shapeIssues, ...linkIssues, ...orphan, ...keyIssues];
}

async function readSpec(path: string, file: string): Promise<SpecRead> {
  try {
    return { doc: parseMarkdown(await readFile(path, "utf8"), file) };
  } catch (error) {
    if (!(error instanceof RowblyError)) {
      throw error;
    }

    return { issue: frontmatterIssue(error, file) };
  }
}

async function checkSpecFile(
  run: DoctorRun,
  projectKey: string,
  storyIds: ReadonlySet<string>,
  name: string,
): Promise<DoctorIssue[]> {
  const path = join(run.paths.specsDir, name);
  const file = rel(run, path);
  const slug = name.slice(0, -3);

  if (!SPEC_SLUG_PATTERN.test(slug)) {
    const message = `"${slug}" is not a valid spec slug (lowercase letters and digits, with - between words)`;

    return [noted({ severity: "error", message, file })];
  }

  const read = await readSpec(path, file);

  if ("issue" in read) {
    return [read.issue];
  }

  return checkSpec(run, { projectKey, storyIds, file }, { slug, path, doc: read.doc });
}

/** Each spec must have a title and link only to Stories that exist. A spec with no Story is an orphan. */
export async function checkSpecs(run: DoctorRun, config: ProjectConfig): Promise<DoctorIssue[]> {
  const storyNames = await listMarkdownFiles(run.paths.storiesDir);
  const storyIds = new Set(storyNames.flatMap((name) => storyIdOf(config.projectKey, name)));
  const names = await listMarkdownFiles(run.paths.specsDir);

  const issues = await mapInOrder(names, (name) => checkSpecFile(run, config.projectKey, storyIds, name));

  return issues.flat();
}
