import type { Dispatch, SetStateAction } from "react";
import { checkStageKey, toStageKey } from "../../../../services/config/config.js";
import {
  FACTORY_SKILL,
  isAlwaysEnabledStage,
  type OnboardingInput,
  type OnboardingOptions,
  requiredSkills,
  withCustomStages,
} from "../../../../services/onboarding/onboarding.js";
import type { KeyHint } from "../../../keymap.js";
import type { OnboardingChecklistProps } from "../onboarding-checklist/index.js";

/** The steps of onboarding, in order. */
export type Step = "start" | "project" | "stages" | "skills" | "harnesses" | "summary";

/** The steps that pick from a list. */
export type ChecklistStep = "stages" | "skills" | "harnesses";

/** The answers of the person so far. A missing answer uses the default. */
export interface Choices {
  readonly name?: string;
  readonly key?: string;
  /** The checked Stages, by name. */
  readonly stages?: readonly string[];
  /** The custom Stages that the user added, also when they are not checked. */
  readonly custom: readonly string[];
  readonly skills?: readonly string[];
  readonly harnesses?: readonly string[];
}

/** The values of the steps, from the defaults and the answers. */
export interface OnboardingView {
  readonly defaults: OnboardingOptions;
  readonly custom: readonly string[];
  /** The rows of the Stages step: the default Stages and the custom Stages. */
  readonly stageChoices: readonly string[];
  readonly stages: readonly string[];
  /** The skills that the checked Stages use. */
  readonly required: readonly string[];
  readonly skills: readonly string[];
  readonly harnesses: readonly string[];
  /** The input of the summary. With defaults, it is empty. */
  readonly input: OnboardingInput;
}

/** What the steps of onboarding read and change. */
export interface OnboardingEnv {
  readonly setStep: Dispatch<SetStateAction<Step>>;
  readonly setCustomize: Dispatch<SetStateAction<boolean>>;
  readonly setChoices: Dispatch<SetStateAction<Choices>>;
  readonly onHints: (hints: readonly KeyHint[]) => void;
}

/** The checklist props that are not the same for each step. */
type ChecklistProps = Omit<OnboardingChecklistProps, "onHints">;

/** The values of each step. The required skills always stay in the list of skills. */
export function onboardingView(defaults: OnboardingOptions, choices: Choices, customize: boolean): OnboardingView {
  const stageChoices = withCustomStages(defaults.stages, choices.custom);
  const stages = choices.stages ?? stageChoices;
  const required = requiredSkills(stages);
  const skills = [...new Set([...required, ...(choices.skills ?? defaults.skills)])];
  const harnesses = choices.harnesses ?? defaults.harnesses.map((harness) => harness.id);

  const input: OnboardingInput = customize
    ? {
        name: choices.name,
        key: choices.key,
        stages: [...stages],
        skills,
        harnesses: skills.length > 0 ? [...harnesses] : [],
      }
    : {};

  return { defaults, custom: choices.custom, stageChoices, stages, required, skills, harnesses, input };
}

/** Keeps the answers and goes to the next step. */
export function choose(env: OnboardingEnv, update: Partial<Choices>, next: Step): void {
  env.setChoices((current) => ({ ...current, ...update }));
  env.setStep(next);
}

/** The first answer: the defaults go directly to the summary. */
export function chooseMode(env: OnboardingEnv, mode: "defaults" | "customize"): void {
  env.setCustomize(mode === "customize");
  env.setStep(mode === "customize" ? "project" : "summary");
}

/** The step before the summary: the start with defaults, or else the last list step that the person saw. */
export function summaryBackStep(customize: boolean, skills: readonly string[]): Step {
  if (!customize) {
    return "start";
  }

  return skills.length > 0 ? "harnesses" : "skills";
}

function stageDescription(stage: string, custom: readonly string[]): string | undefined {
  if (isAlwaysEnabledStage(stage)) {
    return "(always enabled)";
  }

  return custom.includes(stage) ? "custom" : undefined;
}

function skillDescription(skill: string, required: readonly string[]): string | undefined {
  if (required.includes(skill)) {
    return "(required)";
  }

  return skill === FACTORY_SKILL ? "(required to use the factory)" : undefined;
}

/** Adds a custom Stage. A Stage with the key of a row that exists checks that row. */
function addStage(env: OnboardingEnv, view: OnboardingView, text: string): { value: string } | { error: string } {
  const label = text.trim();
  const issue = checkStageKey(toStageKey(label))[0];
  const existing = view.stageChoices.find((stage) => toStageKey(stage) === toStageKey(label));

  if (issue) {
    return { error: issue.message };
  }

  if (existing) {
    return { value: existing };
  }

  env.setChoices((current) => ({ ...current, custom: [...current.custom, label] }));

  return { value: label };
}

function stagesChecklist(env: OnboardingEnv, view: OnboardingView): ChecklistProps {
  return {
    heading: "Stages",
    description: "Default Stages have a prompt. A custom Stage gets a placeholder prompt.",
    items: view.stageChoices.map((stage) => ({
      value: stage,
      label: stage,
      description: stageDescription(stage, view.custom),
      locked: isAlwaysEnabledStage(stage),
    })),
    selected: view.stages,
    add: { label: "New Stage", onAdd: (text) => addStage(env, view, text) },
    onSubmit: (values) => choose(env, { stages: values }, "skills"),
    onBack: () => env.setStep("project"),
  };
}

function skillsChecklist(env: OnboardingEnv, view: OnboardingView): ChecklistProps {
  return {
    heading: "Agent skills",
    description: `Your default Stages use the required skills. The factory requires the companion skill "${FACTORY_SKILL}".`,
    items: view.defaults.skills.map((skill) => ({
      value: skill,
      label: skill,
      description: skillDescription(skill, view.required),
      locked: view.required.includes(skill),
    })),
    selected: view.skills,
    onSubmit: (values) => choose(env, { skills: values }, values.length > 0 ? "harnesses" : "summary"),
    onBack: () => env.setStep("stages"),
  };
}

function harnessesChecklist(env: OnboardingEnv, view: OnboardingView): ChecklistProps {
  return {
    heading: "Agent skills › Harnesses",
    description: "Rowbly installs each skill for each harness that you choose.",
    items: view.defaults.harnesses.map(({ id, dir }) => ({ value: id, label: id, description: dir })),
    selected: view.harnesses,
    emptyError: "Choose at least one harness",
    onSubmit: (values) => choose(env, { harnesses: values }, "summary"),
    onBack: () => env.setStep("skills"),
  };
}

/** The props of the checklist of a list step. */
export function checklistProps(env: OnboardingEnv, view: OnboardingView, step: ChecklistStep): ChecklistProps {
  if (step === "stages") {
    return stagesChecklist(env, view);
  }

  return step === "skills" ? skillsChecklist(env, view) : harnessesChecklist(env, view);
}
