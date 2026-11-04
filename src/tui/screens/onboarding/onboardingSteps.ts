import type { KeyHint } from '../../keymap';

/** How a person uses the Data Root, chosen in the Usage step. */
export type Mode = 'kanban' | 'factory' | 'both';

/** Data Root onboarding's steps in order; the ids are saved in `onboardingSteps` (ADR-0057). */
export const ONBOARDING_STEPS = [
  { id: 'mode', label: 'Usage' },
  { id: 'board', label: 'Board' },
  { id: 'plugins', label: 'Plugins' },
  { id: 'skills', label: 'Agent skills' },
  { id: 'stage-prompts', label: 'Stage Prompts' },
  { id: 'finish', label: 'Summary' },
] as const;

export type StepId = (typeof ONBOARDING_STEPS)[number]['id'];

/** Shown steps follow Software Factory's state and omit Board when there is exactly one. */
export function visibleSteps(mode: Mode, boardCount?: number): StepId[] {
  return ONBOARDING_STEPS.map((step) => step.id).filter((id) =>
    id === 'board' ? boardCount !== 1 : id === 'stage-prompts' ? mode !== 'kanban' : true,
  );
}

/** Retired ids still count as complete; callers preserve the original saved list. */
export function completedSteps(done: readonly string[]): string[] {
  return [
    ...done,
    ...(done.includes('ai') ? ['skills'] : []),
    ...(done.includes('factory-setup') ? ['stage-prompts'] : []),
  ];
}

/** The first shown step that is not done, or Summary when every one is. */
export function firstIncomplete(steps: readonly StepId[], done: readonly string[]): StepId {
  return steps.find((id) => id !== 'finish' && !done.includes(id)) ?? 'finish';
}

/** The key hint for onboarding's Back and Next Buttons, shown on every step. */
export const NAV_HINT: KeyHint = { key: 'shift+←/→', description: 'back/next step' };
