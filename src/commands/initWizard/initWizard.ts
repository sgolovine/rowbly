import { cancel, confirm, intro, isCancel, multiselect, note, select, text } from "@clack/prompts";
import { checkProjectKey, checkStageKey, toProjectKey, toStageKey } from "../../services/config/config.js";
import {
  isAlwaysEnabledStage,
  type OnboardingInput,
  type OnboardingOptions,
  type OnboardingPlan,
  onboardingOptions,
  planOnboarding,
  requiredSkills,
  summarizePlan,
  withCustomStages,
} from "../../services/onboarding/onboarding.js";
import type { ServiceContext } from "../../services/workspace/workspace.js";

/** Thrown when the user presses `ctrl+c` in a prompt. */
class SetupCancelled extends Error {}

function answer<T>(value: T): Exclude<T, symbol> {
  if (isCancel(value)) throw new SetupCancelled();
  return value as Exclude<T, symbol>;
}

function splitNames(value: string | undefined): string[] {
  return (value ?? "")
    .split(",")
    .map((name) => name.trim())
    .filter(Boolean);
}

/** The error message for a list of custom stage names, or `undefined` if the list is valid. */
function checkCustomStages(value: string | undefined): string | undefined {
  return splitNames(value).flatMap((name) => checkStageKey(toStageKey(name)))[0]?.message;
}

async function askProject(options: OnboardingOptions): Promise<{ name: string; key: string }> {
  const name = answer(
    await text({
      message: "Project name",
      initialValue: options.name,
      validate: (value) => (value?.trim() ? undefined : "Name is required"),
    }),
  ).trim();
  const key = answer(
    await text({
      message: "Project key (the prefix of each story ID)",
      initialValue: toProjectKey(name),
      validate: (value) => checkProjectKey((value ?? "").trim().toUpperCase())[0]?.message,
    }),
  ).trim();
  return { name, key };
}

async function askStages(options: OnboardingOptions): Promise<string[]> {
  const optional = options.stages.filter((stage) => !isAlwaysEnabledStage(stage));
  const picked = answer(
    await multiselect({
      message: "Which other default stages do you want? Backlog and Done are always enabled.",
      options: optional.map((stage) => ({ value: stage, label: stage })),
      initialValues: optional,
      required: false,
    }),
  );
  const selected = options.stages.filter((stage) => isAlwaysEnabledStage(stage) || picked.includes(stage));
  const custom = answer(
    await text({
      message: "Custom stages, separated by commas (each one gets a placeholder prompt)",
      placeholder: "QA, Staging",
      validate: checkCustomStages,
    }),
  );
  return withCustomStages(selected, splitNames(custom));
}

async function askSkills(options: OnboardingOptions, stages: string[]): Promise<string[]> {
  const required = requiredSkills(stages);
  const selected = answer(
    await multiselect({
      message: "Which skills do you want to install?",
      options: options.skills.map((skill) =>
        required.includes(skill)
          ? { value: skill, label: `${skill} (required)`, hint: "always installed" }
          : { value: skill, label: skill },
      ),
      initialValues: options.skills,
      required: false,
    }),
  );
  return [...new Set([...required, ...selected])];
}

async function askHarnesses(options: OnboardingOptions): Promise<string[]> {
  return answer(
    await multiselect({
      message: "Which harnesses do you want the skills for?",
      options: options.harnesses.map(({ id, dir }) => ({ value: id as string, label: id, hint: dir })),
      initialValues: options.harnesses.map(({ id }) => id as string),
      required: true,
    }),
  );
}

async function askCustomized(options: OnboardingOptions): Promise<OnboardingInput> {
  const project = await askProject(options);
  const stages = await askStages(options);
  const skills = await askSkills(options, stages);
  return { ...project, stages, skills, harnesses: skills.length > 0 ? await askHarnesses(options) : [] };
}

function rows(items: { label: string; value: string }[]): string {
  const width = Math.max(...items.map((item) => item.label.length)) + 2;
  return items.map((item) => `${item.label.padEnd(width)}${item.value}`).join("\n");
}

function showPlan(plan: OnboardingPlan): void {
  note(rows(summarizePlan(plan)), "Summary");
  note(rows(plan.edits.map(({ what, where }) => ({ label: what, value: where }))), "Where to edit this later");
}

/**
 * Asks the onboarding questions in the terminal and shows the summary.
 * @returns The choices to apply, or `null` if the user cancels.
 */
export async function askOnboarding(ctx: ServiceContext): Promise<OnboardingInput | null> {
  // An existing project stops here, before the first question.
  await planOnboarding({}, ctx);
  const options = await onboardingOptions(ctx);
  intro("Set up Rowbly");
  try {
    const mode = answer(
      await select({
        message: "How do you want to set up this project?",
        options: [
          { value: "defaults", label: "Use defaults", hint: "the summary comes next" },
          { value: "customize", label: "Customize", hint: "choose the name, stages and skills" },
        ],
      }),
    );
    const input = mode === "defaults" ? {} : await askCustomized(options);
    showPlan(await planOnboarding(input, ctx));
    if (answer(await confirm({ message: "Create this project?" }))) return input;
  } catch (error) {
    if (!(error instanceof SetupCancelled)) throw error;
  }
  cancel("Setup cancelled. Rowbly changed nothing.");
  return null;
}
