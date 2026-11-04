/** How a person uses the Data Root, chosen in the Mode step. */
export type Mode = 'kanban' | 'factory' | 'both';

/** Data Root onboarding's steps in order; the ids are saved in `onboardingSteps` (ADR-0057). */
export const ONBOARDING_STEPS = [
  { id: 'mode', label: 'Mode' },
  { id: 'board', label: 'Board' },
  { id: 'plugins', label: 'Plugins' },
  { id: 'ai', label: 'AI and skills' },
  { id: 'factory-setup', label: 'Factory setup' },
  { id: 'stage-prompts', label: 'Stage Prompts' },
  { id: 'finish', label: 'Finish' },
] as const;

export type StepId = (typeof ONBOARDING_STEPS)[number]['id'];

/** The steps a mode shows: the factory steps only with Software Factory on, Plugins not for Software Factory alone. */
export function visibleSteps(mode: Mode): StepId[] {
  return ONBOARDING_STEPS.map((step) => step.id).filter((id) =>
    id === 'plugins' ? mode !== 'factory' : id === 'factory-setup' || id === 'stage-prompts' ? mode !== 'kanban' : true,
  );
}

/** The first shown step that is not done, or Finish when every one is. */
export function firstIncomplete(steps: readonly StepId[], done: readonly string[]): StepId {
  return steps.find((id) => id !== 'finish' && !done.includes(id)) ?? 'finish';
}
