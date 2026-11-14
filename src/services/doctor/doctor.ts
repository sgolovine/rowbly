import { readFile } from "node:fs/promises";
import { type Issue, parseConfig } from "../config/config.js";
import { findProject, type ServiceContext } from "../workspace/workspace.js";
import { checkAttachments } from "./attachment-checks.js";
import { type DoctorIssue, type DoctorRun, noted, rel } from "./doctor-run.js";
import { checkFactory } from "./factory-checks.js";
import { folderIssues, ignoreIssues, threadIssues, trackedRuntimeIssues } from "./project-checks.js";
import { checkPrompts } from "./prompt-checks.js";
import { checkSkills } from "./skill-checks.js";
import { checkSpecs } from "./spec-checks.js";
import { checkStages } from "./stage-checks.js";
import { checkStories } from "./story-checks.js";

export type { DoctorIssue } from "./doctor-run.js";

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

function configIssue(run: DoctorRun, issue: Issue): DoctorIssue {
  const where = issue.path.length > 0 ? `${issue.path.join(".")}: ` : "";

  return noted({ severity: "error", message: `${where}${issue.message}`, file: rel(run, run.paths.configFile) });
}

/**
 * Checks that the files in `.rowbly/` line up with its config: every stage has a file and every
 * file a stage, every story has a title, a known stage and exactly the project's custom fields, and
 * every spec has a title and links to Stories that exist. A spec with no Story is an orphan: a warning.
 * Every skill in the config must be installed for each of its harnesses. Each user prompt must exist.
 * The `factory` section must be valid, and `--fix` moves an old `factory.json` into the config.
 */
export async function doctor(input: DoctorInput = {}, ctx: ServiceContext = {}): Promise<DoctorReport> {
  const paths = await findProject(ctx);
  const run: DoctorRun = { paths, fix: input.fix ?? false, ctx };
  const parsed = parseConfig(await readFile(paths.configFile, "utf8"));

  if (!parsed.config) {
    return { root: paths.root, issues: parsed.issues.map((issue) => configIssue(run, issue)), ok: false };
  }

  const projectIssues = [
    ...(await folderIssues(run)),
    ...(await ignoreIssues(run)),
    ...(await trackedRuntimeIssues(run)),
    ...(await threadIssues(run)),
    ...(await checkPrompts(run)),
  ];
  // A fix can add stages to the config. The later checks use the changed config, as before.
  const stages = await checkStages(run, parsed.config);
  // The stage fix writes the config, so the factory check runs after it and reads the config again.
  const factory = await checkFactory(run);
  const issues = [
    ...projectIssues,
    ...stages.issues,
    ...factory,
    ...(await checkStories(run, stages.config)),
    ...(await checkSpecs(run, stages.config)),
    ...(await checkSkills(run, stages.config)),
    ...(await checkAttachments(run)),
  ];

  return { root: paths.root, issues, ok: !issues.some((issue) => issue.severity === "error" && !issue.fixed) };
}
