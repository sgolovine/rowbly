import { readFile } from "node:fs/promises";
import { join } from "node:path";
import type { ProjectConfig } from "../config/config.js";
import { RowblyError } from "../errors/errors.js";
import { pathOccupied } from "../files/files.js";
import { mapInOrder } from "../in-order/in-order.js";
import { parseMarkdown } from "../markdown/markdown.js";
import { Store } from "../store/store.js";
import {
  isStageFolderName,
  listStoryEntries,
  listStoryFolders,
  moveStoryFile,
  parseStoryFileName,
  STORY_TIME_KEYS,
  type StoryEntry,
  type StoryFile,
  storyHomePath,
  writeStoryFile,
} from "../story-files/story-files.js";
import {
  type DocRepair,
  type DoctorIssue,
  type DoctorRun,
  frontmatterIssue,
  noted,
  rel,
  report,
  reportChange,
  runNow,
  withoutKey,
} from "./doctor-run.js";
import { type PlannedFix, repairDuplicates } from "./duplicate-checks.js";
import { fieldIssues } from "./story-field-checks.js";
import { tagIssues } from "./story-tag-checks.js";
import { uidIssues } from "./story-uid-checks.js";

interface NumberedFile {
  readonly entry: StoryEntry;
  readonly id: string;
  readonly number: number;
}

/** An earlier Story file with the same number as a later one. */
interface RepeatedFile {
  readonly id: string;
  readonly path: string;
}

/**
 * The Story files with a repeated number: each later file → the last earlier file, and each file of a pair. A file
 * that `--fix` gives a new number refers to the Story that keeps the ID, and has the fix.
 */
interface Repeats {
  readonly previous: ReadonlyMap<string, RepeatedFile>;
  readonly paths: ReadonlySet<string>;
  readonly fixes: ReadonlyMap<string, string>;
}

type StoryRead = { readonly story: StoryFile } | { readonly issue: DoctorIssue };

function numberedFile(entry: StoryEntry): NumberedFile[] {
  const parsed = parseStoryFileName(entry.fileName);

  return parsed ? [{ entry, id: entry.fileName.slice(0, -3), number: parsed.number }] : [];
}

function previousEntry(order: readonly NumberedFile[], entry: NumberedFile, index: number): [string, RepeatedFile][] {
  const before = order[index - 1];

  return before?.number === entry.number ? [[entry.entry.path, { id: before.id, path: before.entry.path }]] : [];
}

function plannedPrevious([path, planned]: [string, PlannedFix | undefined]): [string, RepeatedFile][] {
  return planned ? [[path, { id: planned.keptId, path: planned.keptPath }]] : [];
}

function plannedFix([path, planned]: [string, PlannedFix | undefined]): [string, string][] {
  return planned ? [[path, planned.fix]] : [];
}

/**
 * Maps each Story file path to the last earlier file with the same number. A stable sort keeps the file
 * order inside each number, so one pass finds each pair. A group that `--fix` can repair uses the plan.
 */
function repeatedNumbers(
  entries: readonly StoryEntry[],
  planned: ReadonlyMap<string, PlannedFix | undefined>,
): Repeats {
  const order = entries.flatMap(numberedFile).toSorted((a, b) => a.number - b.number);
  const found = new Map(order.flatMap((entry, index) => previousEntry(order, entry, index)));
  const paths = new Set([...found.keys(), ...[...found.values()].map((file) => file.path)]);

  const previous = new Map([
    ...[...found].filter(([path]) => !planned.has(path)),
    ...[...planned].flatMap(plannedPrevious),
  ]);

  return { previous, paths, fixes: new Map([...planned].flatMap(plannedFix)) };
}

async function readStory(
  name: string,
  path: string,
  file: string,
  parsedName: { projectKey: string; number: number },
): Promise<StoryRead> {
  try {
    return {
      story: { id: name.slice(0, -3), ...parsedName, path, doc: parseMarkdown(await readFile(path, "utf8"), file) },
    };
  } catch (error) {
    if (!(error instanceof RowblyError)) {
      throw error;
    }

    return { issue: frontmatterIssue(error, file) };
  }
}

function titleIssues(data: DocRepair["data"], file: string): DoctorIssue[] {
  if (typeof data.title !== "string" || data.title.trim() === "") {
    return [noted({ severity: "error", message: "Title is missing", file })];
  }

  return [];
}

/** A Story must be in a known stage. A missing stage or a stage key in another case has a fix. */
async function stageIssues(
  run: DoctorRun,
  config: ProjectConfig,
  repair: Store<DocRepair>,
  file: string,
): Promise<DoctorIssue[]> {
  const { data } = repair.current;
  const firstStage = config.stages.find((stage) => stage.enabled) ?? config.stages[0];

  if (data.stage === undefined || data.stage === null || data.stage === "") {
    return [
      await reportChange(
        run,
        repair,
        { severity: "error", message: "Stage is missing", file, fix: `Put it in ${firstStage?.key}` },
        (state) => ({ data: { ...state.data, stage: firstStage?.key } }),
      ),
    ];
  }

  const exact = config.stages.find((stage) => stage.key === data.stage);
  const loose = config.stages.find((stage) => stage.key === String(data.stage).trim().toUpperCase());

  if (!exact && loose) {
    return [
      await reportChange(
        run,
        repair,
        { severity: "error", message: `Stage "${String(data.stage)}" should be ${loose.key}`, file, fix: "Correct it" },
        (state) => ({ data: { ...state.data, stage: loose.key } }),
      ),
    ];
  }

  if (!exact) {
    const keys = config.stages.map((s) => s.key).join(", ");

    return [noted({ severity: "error", message: `Unknown stage "${String(data.stage)}". Stages: ${keys}`, file })];
  }

  if (!exact.enabled) {
    return [noted({ severity: "warning", message: `Stage ${exact.key} is disabled`, file })];
  }

  return [];
}

/** Rowbly once wrote agent locks to Story files. The factory state file now records agent activity. */
async function agentLockIssues(run: DoctorRun, repair: Store<DocRepair>, file: string): Promise<DoctorIssue[]> {
  if (!("agentLock" in repair.current.data)) {
    return [];
  }

  return [
    await reportChange(
      run,
      repair,
      { severity: "warning", message: "agentLock is no longer used", file, fix: "Remove it" },
      (state) => ({ data: withoutKey(state.data, "agentLock") }),
    ),
  ];
}

function unknownKeyIssue(run: DoctorRun, repair: Store<DocRepair>, key: string, file: string): Promise<DoctorIssue> {
  return reportChange(
    run,
    repair,
    { severity: "error", message: `"${key}" is not a custom field of this project`, file, fix: "Remove it" },
    (state) => ({ data: withoutKey(state.data, key) }),
  );
}

async function unknownKeyIssues(
  run: DoctorRun,
  config: ProjectConfig,
  repair: Store<DocRepair>,
  file: string,
): Promise<DoctorIssue[]> {
  const known = new Set([
    "title",
    "stage",
    // An old key. It has no effect on the order now, but old Story files can still have it.
    "position",
    "dependsOn",
    "tags",
    ...STORY_TIME_KEYS,
    "agentLock",
    "uid",
    // The Git branch of a Story that got a new number. See `Story.branch`.
    "branch",
    ...config.customFields.map((field) => field.key),
  ]);
  const unknown = Object.keys(repair.current.data).filter((key) => !known.has(key));

  return mapInOrder(unknown, (key) => unknownKeyIssue(run, repair, key, file));
}

/**
 * Checks one Story in order, and gives the frontmatter after the fixes. A fix of the content gives the Story a new
 * `updatedAt`. A new `uid` alone does not, because it does not change the content of the Story.
 */
async function checkStory(
  run: DoctorRun,
  config: ProjectConfig,
  story: StoryFile,
  file: string,
): Promise<{ readonly issues: DoctorIssue[]; readonly data: DocRepair["data"] }> {
  const repair = new Store<DocRepair>({ data: story.doc.data, changed: false });

  const issues = [
    ...titleIssues(repair.current.data, file),
    ...(await stageIssues(run, config, repair, file)),
    ...(await fieldIssues(run, config, repair, file)),
    ...(await tagIssues(run, config, repair, file)),
    ...(await agentLockIssues(run, repair, file)),
    ...(await unknownKeyIssues(run, config, repair, file)),
  ];

  const identity = new Store<DocRepair>({ data: repair.current.data, changed: false });
  const uid = await uidIssues(run, identity, file);
  const updatedAt = repair.current.changed ? runNow(run) : undefined;

  if (repair.current.changed || identity.current.changed) {
    await writeStoryFile(config, story.path, { ...story.doc, data: { ...identity.current.data } }, updatedAt);
  }

  return { issues: [...issues, ...uid], data: identity.current.data };
}

function fixOf(fix: string | undefined): { readonly fix?: string } {
  return fix === undefined ? {} : { fix };
}

/** The file name must use the project key, and its number must be unique. */
function storyNameIssues(
  run: DoctorRun,
  config: ProjectConfig,
  read: { readonly id: string; readonly projectKey: string; readonly number: number },
  other: RepeatedFile | undefined,
  issue: { readonly file: string; readonly fix: string | undefined },
): DoctorIssue[] {
  const { file, fix } = issue;
  const { projectKey, number } = read;
  const message = `Story key ${projectKey} does not match the project key ${config.projectKey}`;
  const repeat = other?.id === read.id ? `Story ID ${read.id}` : `Story number ${number}`;

  const foreign = projectKey !== config.projectKey ? [noted({ severity: "error", message, file })] : [];
  const repeated = other
    ? [noted({ severity: "error", message: `${repeat} is also used by ${rel(run, other.path)}`, file, ...fixOf(fix) })]
    : [];

  return [...foreign, ...repeated];
}

/**
 * The Story file must be in the folder of its Stage. A Story with two files, or a different file at the new path,
 * has no fix, so that `--fix` does not replace a Story.
 */
async function locationIssues(
  run: DoctorRun,
  config: ProjectConfig,
  entry: StoryEntry,
  data: DocRepair["data"],
  repeated: boolean,
): Promise<DoctorIssue[]> {
  const home = storyHomePath(run.paths, config, entry.path, data);

  if (home === entry.path) {
    return [];
  }

  const file = rel(run, entry.path);
  const message =
    entry.folder === null
      ? `Story file is not in the folder of its Stage ${String(data.stage)}`
      : `Story file is in the folder ${entry.folder}, not in the folder of its Stage ${String(data.stage)}`;

  if (repeated || (await pathOccupied(home))) {
    return [noted({ severity: "warning", message, file })];
  }

  return [
    await report(run, { severity: "warning", message, file, fix: `Move it to ${rel(run, home)}` }, () =>
      moveStoryFile(run.paths, entry.path, home),
    ),
  ];
}

async function checkStoryFile(
  run: DoctorRun,
  config: ProjectConfig,
  repeats: Repeats,
  entry: StoryEntry,
): Promise<DoctorIssue[]> {
  const { path } = entry;
  const file = rel(run, path);
  const parsedName = parseStoryFileName(entry.fileName);

  if (!parsedName) {
    return [noted({ severity: "error", message: `File name should be ${config.projectKey}-<number>.md`, file })];
  }

  const id = entry.fileName.slice(0, -3);
  const other = repeats.previous.get(path);
  const nameIssues = storyNameIssues(run, config, { id, ...parsedName }, other, { file, fix: repeats.fixes.get(path) });
  const read = await readStory(entry.fileName, path, file, parsedName);

  if ("issue" in read) {
    return [...nameIssues, read.issue];
  }

  const checked = await checkStory(run, config, read.story, file);
  const location = await locationIssues(run, config, entry, checked.data, repeats.paths.has(path));

  return [...nameIssues, ...checked.issues, ...location];
}

/** Rowbly reads only the subfolders of `stories/` that have the name of a Stage key. */
async function folderNameIssues(run: DoctorRun): Promise<DoctorIssue[]> {
  const folders = (await listStoryFolders(run.paths)).filter((name) => !isStageFolderName(name));

  return folders.map((name) =>
    noted({
      severity: "warning",
      message: "Folder name is not a Stage key, so Rowbly does not read its Story files",
      file: rel(run, join(run.paths.storiesDir, name)),
    }),
  );
}

/**
 * Checks the name, the frontmatter, the stage, the custom fields and the folder of each Story file, directly in
 * `stories/` and in each Stage folder. `--fix` first gives the newer Story of each duplicate Story ID a new number.
 */
export async function checkStories(run: DoctorRun, config: ProjectConfig): Promise<DoctorIssue[]> {
  const duplicates = await repairDuplicates(run);
  const entries = await listStoryEntries(run.paths);
  const repeats = repeatedNumbers(entries, duplicates.planned);

  const issues = await mapInOrder(entries, (entry) => checkStoryFile(run, config, repeats, entry));

  return [...(await folderNameIssues(run)), ...duplicates.issues, ...issues.flat()];
}
