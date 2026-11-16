import { readFile } from "node:fs/promises";
import type { ProjectConfig } from "../config/config.js";
import { RowblyError } from "../errors/errors.js";
import { mapInOrder } from "../in-order/in-order.js";
import { type MarkdownDocument, parseMarkdown } from "../markdown/markdown.js";
import { canonicalStoryId } from "../spec-files/spec-files.js";
import { Store } from "../store/store.js";
import { type DependencyStory, findCycle } from "../story-dependency/story-dependency.js";
import { listStoryFileNames, type StoryFileName, writeStoryFile } from "../story-files/story-files.js";
import {
  type DocRepair,
  type DoctorIssue,
  type DoctorRun,
  type IssueInput,
  noted,
  rel,
  reportChange,
  runNow,
  withoutKey,
} from "./doctor-run.js";

/**
 * The repair of the `dependsOn` list of one Story. `list` is the list without the IDs that the checks reported, also
 * when the run does not fix them. `data` changes only when the run fixes an issue.
 */
interface DependencyRepair extends DocRepair {
  readonly list: readonly string[];
}

/** One Story file of the Project that has valid frontmatter. */
interface DependencyFile {
  readonly id: string;
  readonly path: string;
  readonly file: string;
  readonly doc: MarkdownDocument;
}

/** The values that the checks of one Story need, apart from the repair. */
interface DependencyCheck {
  readonly projectKey: string;
  readonly storyIds: ReadonlySet<string>;
  readonly story: DependencyFile;
}

/** The result of the checks of one Story: its issues and its list for the cycle check. */
interface StoryDependencies {
  readonly issues: readonly DoctorIssue[];
  readonly story: DependencyStory;
  readonly file: string;
}

/** A Story file with invalid frontmatter already has an error from the Story check, so it gives nothing here. */
async function readDependencyFile(run: DoctorRun, name: StoryFileName): Promise<DependencyFile[]> {
  const { path } = name;
  const file = rel(run, path);

  try {
    return [{ id: name.id, path, file, doc: parseMarkdown(await readFile(path, "utf8"), file) }];
  } catch (error) {
    if (!(error instanceof RowblyError)) {
      throw error;
    }

    return [];
  }
}

function isStringList(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === "string");
}

function unique(values: readonly string[]): string[] {
  return [...new Set(values)];
}

/** Records the new list. When the run fixes the issue, the frontmatter gets the same list. */
function reportList(
  run: DoctorRun,
  repair: Store<DependencyRepair>,
  issue: IssueInput,
  next: readonly string[],
): Promise<DoctorIssue> {
  repair.update(() => ({ list: next }));

  return reportChange(run, repair, issue, (state) => ({ data: { ...state.data, dependsOn: [...next] } }));
}

function formIssue(
  run: DoctorRun,
  check: DependencyCheck,
  repair: Store<DependencyRepair>,
  value: string,
): Promise<DoctorIssue> {
  const id = canonicalStoryId(check.projectKey, value) ?? value;
  const next = repair.current.list.map((item) => (item === value ? id : item));
  const message = `dependsOn: Story ID "${value}" should be ${id}`;

  return reportList(run, repair, { severity: "error", message, file: check.story.file, fix: "Correct it" }, next);
}

/** An ID that `canonicalStoryId` can parse, but in a different form. */
function formIssues(run: DoctorRun, check: DependencyCheck, repair: Store<DependencyRepair>): Promise<DoctorIssue[]> {
  const values = repair.current.list.filter((value) => {
    const id = canonicalStoryId(check.projectKey, value);

    return id !== undefined && id !== value;
  });

  return mapInOrder(unique(values), (value) => formIssue(run, check, repair, value));
}

function unknownIssue(
  run: DoctorRun,
  check: DependencyCheck,
  repair: Store<DependencyRepair>,
  value: string,
): Promise<DoctorIssue> {
  const next = repair.current.list.filter((item) => item !== value);
  const message = `dependsOn: "${value}" is not a Story of this project`;

  return reportList(run, repair, { severity: "error", message, file: check.story.file, fix: "Remove the ID" }, next);
}

/** An ID that is not in canonical form after the form check, or that has no Story file. */
function unknownIssues(
  run: DoctorRun,
  check: DependencyCheck,
  repair: Store<DependencyRepair>,
): Promise<DoctorIssue[]> {
  const values = repair.current.list.filter(
    (value) => canonicalStoryId(check.projectKey, value) !== value || !check.storyIds.has(value),
  );

  return mapInOrder(unique(values), (value) => unknownIssue(run, check, repair, value));
}

async function selfIssues(
  run: DoctorRun,
  check: DependencyCheck,
  repair: Store<DependencyRepair>,
): Promise<DoctorIssue[]> {
  const { id, file } = check.story;

  if (!repair.current.list.includes(id)) {
    return [];
  }

  const next = repair.current.list.filter((item) => item !== id);
  const message = `dependsOn: ${id} depends on itself`;

  return [await reportList(run, repair, { severity: "error", message, file, fix: "Remove the ID" }, next)];
}

function repeatIssue(
  run: DoctorRun,
  check: DependencyCheck,
  repair: Store<DependencyRepair>,
  value: string,
): Promise<DoctorIssue> {
  const { list } = repair.current;
  const first = list.indexOf(value);
  const next = list.filter((item, index) => item !== value || index === first);
  const message = `dependsOn: ${value} is in the list more than one time`;
  const issue: IssueInput = { severity: "warning", message, file: check.story.file, fix: "Remove the duplicate" };

  return reportList(run, repair, issue, next);
}

function repeatIssues(run: DoctorRun, check: DependencyCheck, repair: Store<DependencyRepair>): Promise<DoctorIssue[]> {
  const { list } = repair.current;
  const values = list.filter((value, index) => list.indexOf(value) !== index);

  return mapInOrder(unique(values), (value) => repeatIssue(run, check, repair, value));
}

/** The frontmatter, not the reported list, decides: without `--fix`, a list on disk with IDs is not empty. */
async function emptyIssues(
  run: DoctorRun,
  check: DependencyCheck,
  repair: Store<DependencyRepair>,
): Promise<DoctorIssue[]> {
  const value = repair.current.data.dependsOn;

  if (!Array.isArray(value) || value.length > 0) {
    return [];
  }

  const issue: IssueInput = {
    severity: "warning",
    message: "dependsOn is an empty list",
    file: check.story.file,
    fix: "Remove the key",
  };

  return [await reportChange(run, repair, issue, (state) => ({ data: withoutKey(state.data, "dependsOn") }))];
}

/** The checks of a list of strings, in order. Each check reads the list after the checks before it. */
async function listIssues(
  run: DoctorRun,
  check: DependencyCheck,
  repair: Store<DependencyRepair>,
): Promise<DoctorIssue[]> {
  return [
    ...(await formIssues(run, check, repair)),
    ...(await unknownIssues(run, check, repair)),
    ...(await selfIssues(run, check, repair)),
    ...(await repeatIssues(run, check, repair)),
    ...(await emptyIssues(run, check, repair)),
  ];
}

function typeIssue(file: string): DoctorIssue {
  return noted({ severity: "error", message: "dependsOn is not a list of strings", file });
}

/** The cycle check needs only the ID and the list. */
function dependencyStory(story: DependencyFile, list: readonly string[]): DependencyStory {
  return { id: story.id, stage: "", dependsOn: list };
}

/** The issues of the list of one Story. A value that is not a list of strings gives no list to the cycle check. */
async function storyIssues(run: DoctorRun, check: DependencyCheck, config: ProjectConfig): Promise<StoryDependencies> {
  const { story } = check;
  const { data } = story.doc;
  const value = data.dependsOn;

  if (!("dependsOn" in data)) {
    return { issues: [], story: dependencyStory(story, []), file: story.file };
  }

  if (!isStringList(value)) {
    return { issues: [typeIssue(story.file)], story: dependencyStory(story, []), file: story.file };
  }

  const repair = new Store<DependencyRepair>({ data, changed: false, list: value });
  const issues = await listIssues(run, check, repair);

  if (repair.current.changed) {
    await writeStoryFile(config, story.path, { ...story.doc, data: { ...repair.current.data } }, runNow(run));
  }

  return { issues, story: dependencyStory(story, repair.current.list), file: story.file };
}

/** `stories` without the relation from the first Story of the cycle to the next Story of the cycle. */
function withoutRelation(stories: readonly DependencyStory[], cycle: readonly string[]): DependencyStory[] {
  const [from, to] = cycle;

  return stories.map((story) =>
    story.id === from ? { ...story, dependsOn: story.dependsOn.filter((id) => id !== to) } : story,
  );
}

function cycleIssue(cycle: readonly string[], files: ReadonlyMap<string, string>): DoctorIssue {
  const [from = "", to = ""] = cycle;
  const command = `rowbly story update ${from} --remove-dependency ${to}`;
  const message = `The dependencies make a cycle: ${cycle.join(" → ")}. Remove one dependency, for example with "${command}"`;

  return noted({ severity: "error", message, file: files.get(from) ?? "" });
}

/** One error for each cycle. After a cycle, the search continues without one relation of that cycle. */
function cycleIssues(stories: readonly DependencyStory[], files: ReadonlyMap<string, string>): DoctorIssue[] {
  const cycle = findCycle(stories);

  if (cycle === undefined) {
    return [];
  }

  return [cycleIssue(cycle, files), ...cycleIssues(withoutRelation(stories, cycle), files)];
}

/**
 * Checks the `dependsOn` list of each Story of the Project: the type, the ID form, unknown IDs, a self reference,
 * duplicates and an empty list, and then the cycles over all Stories. Run it after the Story checks, because it reads
 * the frontmatter after their fixes.
 */
export async function checkStoryDependencies(run: DoctorRun, config: ProjectConfig): Promise<DoctorIssue[]> {
  const names = (await listStoryFileNames(run.paths)).filter((name) => name.projectKey === config.projectKey);
  const stories = (await mapInOrder(names, (name) => readDependencyFile(run, name))).flat();
  // A Story file with invalid frontmatter is still a Story of the Project.
  const storyIds = new Set(names.map((name) => name.id));

  const results = await mapInOrder(stories, (story) =>
    storyIssues(run, { projectKey: config.projectKey, storyIds, story }, config),
  );
  const files = new Map(results.map((result) => [result.story.id, result.file]));
  const cycles = cycleIssues(
    results.map((result) => result.story),
    files,
  );

  return [...results.flatMap((result) => result.issues), ...cycles];
}
