import { readFile, rm } from "node:fs/promises";
import { join, resolve } from "node:path";
import {
  type CustomField,
  checkProjectKey,
  checkStageKey,
  type Issue,
  labelFromKey,
  SKILL_HARNESSES,
  type SkillHarness,
  throwIfIssues,
  toProjectKey,
  toStageKey,
} from "../config/config.js";
import { ConflictError, ValidationError } from "../errors/errors.js";
import { pathExists } from "../files/files.js";
import { defaultProjectName, getProject, initProject, type Project } from "../project/project.js";
import {
  bundledSkills,
  HARNESS_SKILL_DIRS,
  type InstallSkillResult,
  installSkill,
  packageDir,
  removeSkill,
} from "../skill/skill.js";
import { projectPaths, type ServiceContext } from "../workspace/workspace.js";

/** What a user chooses in onboarding. A choice that is left out takes its default. */
export interface OnboardingInput {
  name?: string;
  key?: string;
  /** In board order. Each entry is the key or name of a default stage, or the name of a custom stage. */
  stages?: string[];
  skills?: string[];
  /** Every skill in `skills` is installed for each of these harnesses. */
  harnesses?: string[];
}

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

interface PlannedStage {
  key: string;
  label: string;
  /** `true`: the stage is not a default stage, so its prompt is a placeholder. */
  custom: boolean;
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
}

export interface OnboardingResult extends Project {
  installed: InstallSkillResult[];
  edits: EditLocation[];
}

/** The stages in the top-level `stages/` folder, in board order, and the skills that their prompts use. */
const DEFAULT_STAGES = [
  { key: "BACKLOG", skills: [] },
  { key: "IN_REFINEMENT", skills: ["refine"] },
  { key: "IN_DEVELOPMENT", skills: ["develop"] },
  { key: "IN_REVIEW", skills: ["review"] },
  { key: "DONE", skills: [] },
] as const;

/** The custom fields that the bundled skills read and write. */
const SKILL_FIELDS: readonly { field: CustomField; skills: readonly string[] }[] = [
  { field: { key: "worktree", label: "Worktree", type: "string" }, skills: ["develop"] },
  { field: { key: "pull_request", label: "Pull request", type: "url" }, skills: ["develop", "review"] },
];

const EDIT_LOCATIONS: readonly EditLocation[] = [
  { what: "Name and key", where: "Settings › Project, or rowbly update-project" },
  { what: "Stages", where: "Settings › Stages, or rowbly create-stage, update-stage and delete-stage" },
  { what: "Stage prompts", where: ".rowbly/stages/<KEY>.md, or Settings › Stages" },
  { what: "Custom fields", where: "Settings › Custom fields, or rowbly add-custom-field" },
  { what: "Skills", where: "rowbly install-skill and rowbly remove-skill" },
];

const INPUT_KEYS = ["name", "key", "stages", "skills", "harnesses"];

/** The CLI prints the list of issues only if there are two or more, so one issue must be the message. */
function headline(issues: Issue[], several: string): string {
  return issues.length === 1 ? (issues[0]?.message ?? several) : several;
}

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

/** The skills that the default stages among `stages` use. */
export function requiredSkills(stages: readonly string[]): string[] {
  const keys = stages.map(toStageKey);
  return DEFAULT_STAGES.filter((stage) => keys.includes(stage.key)).flatMap((stage) => [...stage.skills]);
}

/** Puts the `custom` stages that are not in `stages` before Done, or at the end if there is no Done. */
export function withCustomStages(stages: readonly string[], custom: readonly string[]): string[] {
  const keys = new Set(stages.map(toStageKey));
  const added = custom.filter((label) => {
    const fresh = !keys.has(toStageKey(label));
    keys.add(toStageKey(label));
    return fresh;
  });
  const done = stages.findIndex((stage) => toStageKey(stage) === "DONE");
  const at = done < 0 ? stages.length : done;
  return [...stages.slice(0, at), ...added, ...stages.slice(at)];
}

function planStages(names: readonly string[], issues: Issue[]): PlannedStage[] {
  if (names.length === 0) issues.push({ path: ["stages"], message: "Choose at least one stage" });
  const seen = new Set<string>();
  return names.map((name, index) => {
    const key = toStageKey(name);
    const isDefault = DEFAULT_STAGES.some((stage) => stage.key === key);
    issues.push(...checkStageKey(key, ["stages", index]));
    if (seen.has(key)) issues.push({ path: ["stages", index], message: `Stage ${key} is listed twice` });
    seen.add(key);
    return { key, label: isDefault ? labelFromKey(key) : name.trim(), custom: !isDefault };
  });
}

/** Checks the choices and resolves the defaults. It writes nothing. */
export async function planOnboarding(input: OnboardingInput = {}, ctx: ServiceContext = {}): Promise<OnboardingPlan> {
  const options = await onboardingOptions(ctx);
  const root = resolve(ctx.cwd ?? process.cwd());
  const { dir } = projectPaths(root);
  if (await pathExists(dir)) {
    throw new ConflictError(`${dir} already exists`, { hint: "Run `rowbly doctor` to check the existing project." });
  }

  const issues: Issue[] = [];
  const name = (input.name ?? options.name).trim();
  const key = (input.key ?? toProjectKey(name)).trim().toUpperCase();
  if (name === "") issues.push({ path: ["name"], message: "Name is required" });
  issues.push(...checkProjectKey(key, ["key"]));

  const stages = planStages(input.stages ?? options.stages, issues);
  const required = requiredSkills(stages.map((stage) => stage.key));
  const skills = [...new Set(input.skills ?? options.skills)];
  for (const skill of skills) {
    if (!options.skills.includes(skill)) issues.push({ path: ["skills"], message: `Unknown skill "${skill}"` });
  }
  for (const skill of required) {
    if (!skills.includes(skill)) {
      issues.push({ path: ["skills"], message: `Skill "${skill}" is required by the selected default stages` });
    }
  }

  const harnesses = skills.length === 0 ? [] : [...new Set(input.harnesses ?? SKILL_HARNESSES)];
  for (const harness of harnesses) {
    if (!SKILL_HARNESSES.includes(harness as SkillHarness)) {
      issues.push({ path: ["harnesses"], message: `Unknown harness "${harness}"` });
    }
  }
  if (skills.length > 0 && harnesses.length === 0) {
    issues.push({ path: ["harnesses"], message: "Choose at least one harness for the skills" });
  }
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
    stages,
    skills: [...skills].sort().map((skill) => ({ name: skill, required: required.includes(skill) })),
    harnesses: harnesses as SkillHarness[],
    customFields: SKILL_FIELDS.filter(({ skills: users }) => users.some((skill) => skills.includes(skill))).map(
      ({ field }) => field,
    ),
    edits: [...EDIT_LOCATIONS],
  };
}

/** The rows of the summary that both front ends show. */
export function summarizePlan(plan: OnboardingPlan): { label: string; value: string }[] {
  const prompts = (custom: boolean) => plan.stages.filter((stage) => stage.custom === custom).map((s) => s.label);
  const none = "—";
  return [
    { label: "Name", value: plan.name },
    { label: "Key", value: plan.key },
    { label: "Folder", value: plan.root },
    { label: "Stages", value: plan.stages.map((stage) => stage.label).join(" → ") },
    { label: "Default prompts", value: prompts(false).join(", ") || none },
    { label: "Placeholder prompts", value: prompts(true).join(", ") || none },
    {
      label: "Skills",
      value: plan.skills.map((skill) => `${skill.name}${skill.required ? " (required)" : ""}`).join(", ") || none,
    },
    { label: "Harnesses", value: plan.harnesses.join(", ") || none },
    { label: "Custom fields", value: plan.customFields.map((field) => field.key).join(", ") || none },
  ];
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

  const installed: InstallSkillResult[] = [];
  try {
    for (const skill of plan.skills) {
      installed.push(await installSkill({ name: skill.name, harnesses: plan.harnesses }, ctx));
    }
  } catch (error) {
    for (const { name } of installed) await removeSkill({ name }, ctx);
    await rm(projectPaths(plan.root).dir, { recursive: true, force: true });
    throw error;
  }
  return { ...(await getProject(ctx)), installed, edits: plan.edits };
}

function stringList(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === "string");
}

/** Checks the shape of JSON input for `rowbly init`. */
export function parseOnboardingInput(value: unknown): OnboardingInput {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new ValidationError("The setup input must be a JSON object");
  }
  const record = value as Record<string, unknown>;
  const issues: Issue[] = Object.keys(record)
    .filter((key) => !INPUT_KEYS.includes(key))
    .map((key) => ({ path: [key], message: `Unknown setup key "${key}"` }));
  for (const key of ["name", "key"]) {
    if (record[key] !== undefined && typeof record[key] !== "string") {
      issues.push({ path: [key], message: `"${key}" must be a string` });
    }
  }
  for (const key of ["stages", "skills", "harnesses"]) {
    if (record[key] !== undefined && !stringList(record[key])) {
      issues.push({ path: [key], message: `"${key}" must be a list of strings` });
    }
  }
  throwIfIssues(headline(issues, "The setup input is invalid"), issues, `Keys: ${INPUT_KEYS.join(", ")}`);
  return record as OnboardingInput;
}
