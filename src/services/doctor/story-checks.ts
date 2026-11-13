import { readFile } from "node:fs/promises";
import { join } from "node:path";
import type { ProjectConfig } from "../config/config.js";
import { RowblyError } from "../errors/errors.js";
import { listMarkdownFiles } from "../files/files.js";
import { parseMarkdown } from "../markdown/markdown.js";
import { Store } from "../store/store.js";
import { parseStoryFileName, type StoryFile, writeStoryFile } from "../story-files/story-files.js";
import {
  type DocRepair,
  type DoctorIssue,
  type DoctorRun,
  frontmatterIssue,
  noted,
  rel,
  reportChange,
  withoutKey,
} from "./doctor-run.js";
import { mapInOrder } from "./map-in-order.js";
import { fieldIssues } from "./story-field-checks.js";

interface NumberedFile {
  readonly name: string;
  readonly number: number;
}

type StoryRead = { readonly story: StoryFile } | { readonly issue: DoctorIssue };

function numberedFile(name: string): NumberedFile[] {
  const parsed = parseStoryFileName(name);

  return parsed ? [{ name, number: parsed.number }] : [];
}

function previousEntry(order: readonly NumberedFile[], entry: NumberedFile, index: number): [string, string][] {
  const before = order[index - 1];

  return before?.number === entry.number ? [[entry.name, before.name]] : [];
}

/**
 * Maps each Story file name to the last earlier file with the same number. A stable sort keeps the file
 * order inside each number, so one pass finds each pair.
 */
function previousByNumber(names: readonly string[]): ReadonlyMap<string, string> {
  const order = names.flatMap(numberedFile).toSorted((a, b) => a.number - b.number);

  return new Map(order.flatMap((entry, index) => previousEntry(order, entry, index)));
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
  const known = new Set(["title", "stage", "position", "agentLock", ...config.customFields.map((field) => field.key)]);
  const unknown = Object.keys(repair.current.data).filter((key) => !known.has(key));

  return mapInOrder(unknown, (key) => unknownKeyIssue(run, repair, key, file));
}

/** Checks one Story in order. Each check reads the frontmatter after the fixes of the checks before it. */
async function checkStory(
  run: DoctorRun,
  config: ProjectConfig,
  story: StoryFile,
  file: string,
): Promise<DoctorIssue[]> {
  const repair = new Store<DocRepair>({ data: story.doc.data, changed: false });

  const issues = [
    ...titleIssues(repair.current.data, file),
    ...(await stageIssues(run, config, repair, file)),
    ...(await fieldIssues(run, config, repair, file)),
    ...(await agentLockIssues(run, repair, file)),
    ...(await unknownKeyIssues(run, config, repair, file)),
  ];

  if (repair.current.changed) {
    await writeStoryFile(config, story.path, { ...story.doc, data: { ...repair.current.data } });
  }

  return issues;
}

/** The file name must use the project key, and its number must be unique. */
function storyNameIssues(
  config: ProjectConfig,
  parsedName: { projectKey: string; number: number },
  other: string | undefined,
  file: string,
): DoctorIssue[] {
  const { projectKey, number } = parsedName;
  const message = `Story key ${projectKey} does not match the project key ${config.projectKey}`;

  const foreign = projectKey !== config.projectKey ? [noted({ severity: "error", message, file })] : [];
  const repeated = other
    ? [noted({ severity: "error", message: `Story number ${number} is also used by ${other}`, file })]
    : [];

  return [...foreign, ...repeated];
}

async function checkStoryFile(
  run: DoctorRun,
  config: ProjectConfig,
  previous: ReadonlyMap<string, string>,
  name: string,
): Promise<DoctorIssue[]> {
  const path = join(run.paths.storiesDir, name);
  const file = rel(run, path);
  const parsedName = parseStoryFileName(name);

  if (!parsedName) {
    return [noted({ severity: "error", message: `File name should be ${config.projectKey}-<number>.md`, file })];
  }

  const nameIssues = storyNameIssues(config, parsedName, previous.get(name), file);
  const read = await readStory(name, path, file, parsedName);

  if ("issue" in read) {
    return [...nameIssues, read.issue];
  }

  return [...nameIssues, ...(await checkStory(run, config, read.story, file))];
}

/** Checks the name, the frontmatter, the stage and the custom fields of each Story file. */
export async function checkStories(run: DoctorRun, config: ProjectConfig): Promise<DoctorIssue[]> {
  const names = await listMarkdownFiles(run.paths.storiesDir);
  const previous = previousByNumber(names);

  const issues = await mapInOrder(names, (name) => checkStoryFile(run, config, previous, name));

  return issues.flat();
}
