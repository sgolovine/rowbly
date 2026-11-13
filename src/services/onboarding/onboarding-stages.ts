import { checkStageKey, type Issue, labelFromKey, toStageKey } from "../config/config.js";

export interface PlannedStage {
  key: string;
  label: string;
  /** `true`: the stage is not a default stage, so its prompt is a placeholder. */
  custom: boolean;
}

/** The stages of the plan, and the problems with the stage choices. */
interface StagePlan {
  readonly stages: PlannedStage[];
  readonly issues: readonly Issue[];
}

/** The stages in the top-level `stages/` folder, in board order, and the skills that their prompts use. */
export const DEFAULT_STAGES = [
  { key: "BACKLOG", skills: [] },
  { key: "IN_REFINEMENT", skills: ["refine"] },
  { key: "IN_DEVELOPMENT", skills: ["develop"] },
  { key: "IN_REVIEW", skills: ["review"] },
  { key: "DONE", skills: [] },
] as const;

/** The default stages that onboarding always creates. */
const ALWAYS_ENABLED_STAGES = ["BACKLOG", "DONE"];

/** The skills that the default stages among `stages` use. */
export function requiredSkills(stages: readonly string[]): string[] {
  const keys = stages.map(toStageKey);

  return DEFAULT_STAGES.filter((stage) => keys.includes(stage.key)).flatMap((stage) => [...stage.skills]);
}

/** Whether onboarding always creates the stage, so that the user cannot remove it. */
export function isAlwaysEnabledStage(stage: string): boolean {
  return ALWAYS_ENABLED_STAGES.includes(toStageKey(stage));
}

/** Adds Backlog at the start and Done at the end of `stages`, if they are not in the list. */
export function withAlwaysEnabledStages(stages: readonly string[]): string[] {
  const keys = stages.map(toStageKey);

  return [
    ...(keys.includes("BACKLOG") ? [] : [labelFromKey("BACKLOG")]),
    ...stages,
    ...(keys.includes("DONE") ? [] : [labelFromKey("DONE")]),
  ];
}

/** Adds `label` when no stage and no earlier added label has its key. */
function addCustomStage(keys: ReadonlySet<string>, added: readonly string[], label: string): readonly string[] {
  const key = toStageKey(label);

  if (keys.has(key) || added.some((other) => toStageKey(other) === key)) {
    return added;
  }

  return [...added, label];
}

/** Puts the `custom` stages that are not in `stages` before Done, or at the end if there is no Done. */
export function withCustomStages(stages: readonly string[], custom: readonly string[]): string[] {
  const keys = new Set(stages.map(toStageKey));
  const added = custom.reduce<readonly string[]>((list, label) => addCustomStage(keys, list, label), []);
  const done = stages.findIndex((stage) => toStageKey(stage) === "DONE");
  const at = done < 0 ? stages.length : done;

  return [...stages.slice(0, at), ...added, ...stages.slice(at)];
}

/** Plans one stage. Only the second and later entries of a key give the duplicate issue. */
function planStage(names: readonly string[], name: string, index: number): StagePlan {
  const key = toStageKey(name);
  const isDefault = DEFAULT_STAGES.some((stage) => stage.key === key);
  const twice = names.findIndex((other) => toStageKey(other) === key) < index;

  const issues = [
    ...checkStageKey(key, ["stages", index]),
    ...(twice ? [{ path: ["stages", index], message: `Stage ${key} is listed twice` }] : []),
  ];

  return { stages: [{ key, label: isDefault ? labelFromKey(key) : name.trim(), custom: !isDefault }], issues };
}

/** Plans the stages in board order, and checks their keys. */
export function planStages(names: readonly string[]): StagePlan {
  const planned = names.map((name, index) => planStage(names, name, index));

  return {
    stages: planned.flatMap((plan) => plan.stages),
    issues: planned.flatMap((plan) => plan.issues),
  };
}
