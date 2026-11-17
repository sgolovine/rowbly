import { ValidationError } from "../errors/errors.js";
import { isRecord } from "./model-settings.js";

/** The classes that `factory.stageClasses` can set. */
const STAGE_CLASSES = ["work", "hold"] as const;

/** The class that the user sets for a Stage: `work` gets workers, `hold` gets none. */
export type StageClass = (typeof STAGE_CLASSES)[number];

/** The class of each Stage, by Stage key. */
export type StageClasses = Readonly<Record<string, StageClass>>;

/** The class of a Stage after the rule: a user class, `invalid` for an empty prompt, or the class of its place. */
export type PromptClass = StageClass | "invalid";

/** The Stage class values of `rowbly factory configure`. */
export interface StageClassInput {
  readonly class?: string;
  readonly clearClass?: boolean;
}

/** The Stage facts that the class rule uses. */
interface ClassedStage {
  readonly key: string;
  readonly prompt: string;
}

function isStageClass(value: unknown): value is StageClass {
  return STAGE_CLASSES.some((stageClass) => stageClass === value);
}

/** Tells if a value is an absent `stageClasses` key or a map of known classes. Unknown Stage keys are valid. */
export function validStageClasses(value: unknown): boolean {
  return value === undefined || (isRecord(value) && Object.values(value).every(isStageClass));
}

/** Tells if the configure flags set or clear the class of a Stage. */
export function hasStageClassInput(input: StageClassInput): boolean {
  return input.class !== undefined || !!input.clearClass;
}

/** The configure keys that a Stage class can use. */
const CLASS_KEYS: readonly string[] = ["stage", "class", "clearClass"];

/** Gives the first rule that the flags of a Stage class break, or undefined. */
export function stageClassProblem(input: StageClassInput & { readonly stage?: string }): string | undefined {
  if (input.class !== undefined && input.clearClass) {
    return "Do not select a class when you clear it";
  }

  if (input.stage === undefined) {
    return "Select the Stage of the class";
  }

  const others = Object.entries(input).filter(([key, value]) => !CLASS_KEYS.includes(key) && value !== undefined);

  return others.length ? "A Stage class sets only the class of the Stage" : undefined;
}

/** Gives the class that the input sets, or undefined for a clear. A value other than `work` or `hold` throws. */
export function stageClassChoice(input: StageClassInput): StageClass | undefined {
  if (input.clearClass) {
    return undefined;
  }

  if (!isStageClass(input.class)) {
    throw new ValidationError(`Use ${STAGE_CLASSES.join(" or ")} for --class`, {
      details: { issues: [{ path: ["class"], message: `must be one of ${STAGE_CLASSES.join(", ")}` }] },
    });
  }

  return input.class;
}

/** Gives the `stageClasses` key with the class of the Stage set, or removed without a class. An empty map is not kept. */
export function withStageClass(
  classes: StageClasses | undefined,
  stage: string,
  stageClass: StageClass | undefined,
): { readonly stageClasses?: StageClasses } {
  const others = Object.entries(classes ?? {}).filter(([key]) => key !== stage);
  const entries = stageClass === undefined ? others : [...others, [stage, stageClass] as const];

  return { stageClasses: entries.length ? Object.fromEntries(entries) : undefined };
}

/**
 * Gives the class of the Stage at an index of the board order. A user class comes first. Then an empty prompt is
 * `invalid`, the first Stage and the last Stage are `hold`, and all other Stages are `work`.
 */
export function stageClassOf(
  stages: readonly ClassedStage[],
  index: number,
  classes: StageClasses | undefined,
): PromptClass {
  const stage = stages[index] as ClassedStage;
  const userClass = classes?.[stage.key];

  if (userClass !== undefined) {
    return userClass;
  }

  if (!stage.prompt.trim()) {
    return "invalid";
  }

  return index === 0 || index === stages.length - 1 ? "hold" : "work";
}
