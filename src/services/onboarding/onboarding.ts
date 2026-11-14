import { readFile, rm } from "node:fs/promises";
import { join, resolve } from "node:path";
import {
  type CustomField,
  checkProjectKey,
  type Issue,
  labelFromKey,
  SKILL_HARNESSES,
  type SkillHarness,
  throwIfIssues,
  toProjectKey,
} from "../config/config.js";
import { ConflictError } from "../errors/errors.js";
import { pathExists } from "../files/files.js";
import { mapInOrder } from "../in-order/in-order.js";
import { defaultProjectName, getProject, initProject, type Project } from "../project/project.js";
import {
  bundledSkills,
  HARNESS_SKILL_DIRS,
  type InstallSkillResult,
  installSkill,
  packageDir,
  removeSkill,
} from "../skill/skill.js";
import { Store } from "../store/store.js";
import { projectPaths, type ServiceContext } from "../workspace/workspace.js";
import { headline, type OnboardingInput } from "./onboarding-input.js";
import {
  DEFAULT_STAGES,
  type PlannedStage,
  planStages,
  requiredSkills,
  withAlwaysEnabledStages,
} from "./onboarding-stages.js";

export { type OnboardingInput, parseOnboardingInput } from "./onboarding-input.js";
export { isAlwaysEnabledStage, requiredSkills, withCustomStages } from "./onboarding-stages.js";

interface OnboardingHarness {
  id: SkillHarness;
  /** The project skills folder of the harness. */
  dir: string;
}

/** The defaults of each onboarding step. */
export interface OnboardingOptions {
  name: string;
  key: string;
  /** The default stages, by name, in board order. */
  stages: string[];
  skills: string[];
  harnesses: OnboardingHarness[];
}

interface PlannedSkill {
  name: string;
  /** A selected default stage uses the skill. */
  required: boolean;
}

interface EditLocation {
  what: string;
  where: string;
}

/** Everything that `applyOnboarding` will create, for the summary. */
export interface OnboardingPlan {
  name: string;
  key: string;
  root: string;
  stages: PlannedStage[];
  skills: PlannedSkill[];
  harnesses: SkillHarness[];
  customFields: CustomField[];
  edits: EditLocation[];
  /** The problems that do not stop the setup. */
  warnings: string[];
}

export interface OnboardingResult extends Project {
  installed: InstallSkillResult[];
  edits: EditLocation[];
  warnings: string[];
}

/** The skills that the onboarding installed so far, for the rollback. */
interface InstallProgress {
  readonly installed: readonly InstallSkillResult[];
}

/** The custom fields that the bundled skills read and write. */
const SKILL_FIELDS: readonly { field: CustomField; skills: readonly string[] }[] = [
  { field: { key: "worktree", label: "Worktree", type: "string" }, skills: ["develop"] },
  { field: { key: "pull_request", label: "Pull request", type: "url" }, skills: ["develop", "review"] },
];

const EDIT_LOCATIONS: readonly EditLocation[] = [
  { what: "Name and key", where: "Settings › Project, or rowbly project update" },
  { what: "Stages", where: "Settings › Stages, or rowbly stage create, stage update and stage delete" },
  { what: "Stage prompts", where: ".rowbly/stages/<KEY>.md, or Settings › Stages" },
  { what: "Agent prompts", where: ".rowbly/prompts/, Settings › Prompts, or rowbly prompt set" },
  { what: "Custom fields", where: "Settings › Custom fields, or rowbly custom-field add" },
  { what: "Skills", where: "rowbly skill install and rowbly skill remove" },
];

function placeholderPrompt(label: string): string {
  return `This is a placeholder. Replace this text with the instructions for agents in the ${label} stage.\n\nUntil then, do not work on stories in this stage.`;
}

/** The default of each step for a project in `ctx.cwd`. */
export async function onboardingOptions(ctx: ServiceContext = {}): Promise<OnboardingOptions> {
  const name = defaultProjectName(ctx);

  return {
    name,
    key: toProjectKey(name),
    stages: DEFAULT_STAGES.map((stage) => labelFromKey(stage.key)),
    skills: (await bundledSkills(ctx)).names,
    harnesses: SKILL_HARNESSES.map((id) => ({ id, dir: HARNESS_SKILL_DIRS[id] })),
  };
}

function nameIssues(name: string): Issue[] {
  return name === "" ? [{ path: ["name"], message: "Name is required" }] : [];
}

/** Unknown skills first, then the required skills that the choice leaves out. */
function skillIssues(skills: readonly string[], bundled: readonly string[], required: readonly string[]): Issue[] {
  return [
    ...skills
      .filter((skill) => !bundled.includes(skill))
      .map((skill) => ({ path: ["skills"], message: `Unknown skill "${skill}"` })),
    ...required
      .filter((skill) => !skills.includes(skill))
      .map((skill) => ({ path: ["skills"], message: `Skill "${skill}" is required by the selected default stages` })),
  ];
}

function harnessIssues(skills: readonly string[], harnesses: readonly string[]): Issue[] {
  return [
    ...harnesses
      .filter((harness) => !SKILL_HARNESSES.includes(harness as SkillHarness))
      .map((harness) => ({ path: ["harnesses"], message: `Unknown harness "${harness}"` })),
    ...(skills.length > 0 && harnesses.length === 0
      ? [{ path: ["harnesses"], message: "Choose at least one harness for the skills" }]
      : []),
  ];
}

/** Checks the choices and resolves the defaults. It writes nothing. */
export async function planOnboarding(input: OnboardingInput = {}, ctx: ServiceContext = {}): Promise<OnboardingPlan> {
  const options = await onboardingOptions(ctx);
  const root = resolve(ctx.cwd ?? process.cwd());
  const { dir } = projectPaths(root);

  if (await pathExists(dir)) {
    throw new ConflictError(`${dir} already exists`, { hint: "Run `rowbly doctor` to check the existing project." });
  }

  const name = (input.name ?? options.name).trim();
  const key = (input.key ?? toProjectKey(name)).trim().toUpperCase();
  const planned = planStages(withAlwaysEnabledStages(input.stages ?? options.stages));
  const required = requiredSkills(planned.stages.map((stage) => stage.key));
  const skills = [...new Set(input.skills ?? options.skills)];
  const harnesses = skills.length === 0 ? [] : [...new Set(input.harnesses ?? SKILL_HARNESSES)];

  const issues = [
    ...nameIssues(name),
    ...checkProjectKey(key, ["key"]),
    ...planned.issues,
    ...skillIssues(skills, options.skills, required),
    ...harnessIssues(skills, harnesses),
  ];
  const harnessIssue = issues.some((issue) => issue.path[0] === "harnesses");

  throwIfIssues(
    headline(issues, "The setup is invalid"),
    issues,
    harnessIssue ? `Harnesses: ${SKILL_HARNESSES.join(", ")}` : undefined,
  );

  return {
    name,
    key,
    root,
    stages: planned.stages,
    skills: skills.toSorted().map((skill) => ({ name: skill, required: required.includes(skill) })),
    harnesses: harnesses as SkillHarness[],
    customFields: SKILL_FIELDS.filter(({ skills: users }) => users.some((skill) => skills.includes(skill))).map(
      ({ field }) => field,
    ),
    edits: [...EDIT_LOCATIONS],
    warnings: [],
  };
}

/** The labels of the stages with a default prompt, or with a placeholder prompt when `custom` is true. */
function stageLabels(plan: OnboardingPlan, custom: boolean): string[] {
  return plan.stages.filter((stage) => stage.custom === custom).map((s) => s.label);
}

/** The rows of the summary that both front ends show. */
export function summarizePlan(plan: OnboardingPlan): { label: string; value: string }[] {
  const none = "—";

  return [
    { label: "Name", value: plan.name },
    { label: "Key", value: plan.key },
    { label: "Folder", value: plan.root },
    { label: "Stages", value: plan.stages.map((stage) => stage.label).join(" → ") },
    { label: "Default prompts", value: stageLabels(plan, false).join(", ") || none },
    { label: "Placeholder prompts", value: stageLabels(plan, true).join(", ") || none },
    {
      label: "Skills",
      value: plan.skills.map((skill) => `${skill.name}${skill.required ? " (required)" : ""}`).join(", ") || none,
    },
    { label: "Harnesses", value: plan.harnesses.join(", ") || none },
    { label: "Custom fields", value: plan.customFields.map((field) => field.key).join(", ") || none },
  ];
}

/** Installs one skill and records it, so that a later failure can remove it. */
async function installAndRecord(
  plan: OnboardingPlan,
  name: string,
  progress: Store<InstallProgress>,
  ctx: ServiceContext,
): Promise<void> {
  const result = await installSkill({ name, harnesses: plan.harnesses }, ctx);

  progress.update((state) => ({ installed: [...state.installed, result] }));
}

/** Installs the skills one at a time. A failure removes the installed skills and the new project. */
async function installPlannedSkills(plan: OnboardingPlan, ctx: ServiceContext): Promise<InstallSkillResult[]> {
  const progress = new Store<InstallProgress>({ installed: [] });

  try {
    await mapInOrder(plan.skills, (skill) => installAndRecord(plan, skill.name, progress, ctx));
  } catch (error) {
    await mapInOrder(progress.current.installed, ({ name }) => removeSkill({ name }, ctx));
    await rm(projectPaths(plan.root).dir, { recursive: true, force: true });
    throw error;
  }

  return [...progress.current.installed];
}

/**
 * Creates the project of the plan and installs its skills. If an install fails, it removes the
 * project and the skills that it installed, so that the user can repair the problem and try again.
 */
export async function applyOnboarding(
  input: OnboardingInput = {},
  ctx: ServiceContext = {},
): Promise<OnboardingResult> {
  const plan = await planOnboarding(input, ctx);
  const stagesDir = join(await packageDir(), "stages");
  const stages = await Promise.all(
    plan.stages.map(async ({ key, label, custom }) => ({
      key,
      label,
      prompt: custom ? placeholderPrompt(label) : await readFile(join(stagesDir, `${key}.md`), "utf8"),
    })),
  );

  await initProject({ name: plan.name, key: plan.key, stages, customFields: plan.customFields }, ctx);

  const installed = await installPlannedSkills(plan, ctx);

  return { ...(await getProject(ctx)), installed, edits: plan.edits, warnings: plan.warnings };
}
