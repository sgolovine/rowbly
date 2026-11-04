# ADR-0057: Data Root onboarding saves its step progress beside its completion flag

**Status:** Accepted; amends [ADR-0041](0041-onboarding-completion-has-two-levels.md) §2. Amended by [ADR-0059](0059-onboarding-combines-stage-prompt-setup.md) for the combined onboarding flow and setup choices.

## 1. Context

Data Root onboarding is a sequence of steps: Mode, Board, Plugins, AI and skills, Factory setup,
Stage Prompts and Finish. ADR-0041 §2 kept every choice in memory ("without new persistent
settings"), so a person who left onboarding, or reopened it from Settings, started again at Mode
with no sign of what they had already done.

## 2. Decision

`rowbly.config.json` has an optional `onboardingSteps`: the ids of the Data Root onboarding steps
completed so far (`mode`, `board`, `plugins`, `ai`, `factory-setup`, `stage-prompts`). It is
committed and shared like `onboardingComplete`, and is the one persistent setting onboarding adds;
the mode and AI answers themselves are still not saved.

- Absent means no step is complete. Readers ignore ids they do not know, and a save keeps them.
- `config.updateRootConfig` takes `onboardingComplete` and `onboardingSteps`, each optional, and
  changes only the keys it is given: saving progress never clears completion.
- Onboarding saves a step's id when the step is done. Opening onboarding (at startup, from
  Settings › Onboarding or by switching to an incomplete Data Root) shows the saved marks and opens
  the first incomplete step.
- Completion stays `onboardingComplete` alone: finishing or skipping sets it whatever steps are
  saved, and saved steps never complete onboarding.

The rest of ADR-0041 §2 is unchanged.

## 3. Rejected alternatives

- Keeping progress in Local State would make each collaborator redo shared setup, which ADR-0041
  rejects for completion.
- Saving the mode and AI answers would add settings that nothing else reads; the Software Factory
  Plugin's state already tells which steps apply.
- Inferring progress from the records (Boards, Plugins, Stages) would mark steps a person never saw.
