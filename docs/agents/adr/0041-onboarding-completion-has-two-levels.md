# ADR-0041: Onboarding completion is per person and shared per Data Root

**Status:** Accepted; startup ordering amended by [ADR-0042](0042-tui-startup-asks-for-a-data-root.md); §2's Stage Prompt templates amended by [ADR-0053](0053-software-factory-setup-gives-default-stages-and-stage-prompts.md), which lets onboarding offer factory setup. §2's "no new persistent settings" amended by [ADR-0057](0057-data-root-onboarding-saves-step-progress.md), which saves step progress. Amended by [ADR-0059](0059-onboarding-combines-stage-prompt-setup.md) for the combined onboarding flow and setup choices.

## 1. Context

A person needs to set global Me and register existing Data Roots once. A Data Root also needs an
introduction to Boards, Plugins and agent skills, shared by the people using it.

## 2. Decision

The optional boolean `onboardingComplete` in `~/.rowblyrc.json` records global completion.
The same optional boolean in the committed `rowbly.config.json` records Data Root completion.
Absent or false means incomplete, including for existing users. Completing or explicitly skipping
sets the corresponding flag. Bare TUI launch opens global onboarding first, then Data Root onboarding.
A named missing Data Root still fails before either flow. Demo mode bypasses onboarding.
Switching to an incomplete Data Root opens its flow. Settings can reopen either flow without
clearing completion. Local Me is preserved. Global onboarding registers existing Data Roots only;
creating a missing Data Root remains the setup flow.

The Data Root flag is deliberately shared: once committed and received, it suppresses onboarding
for everyone using that Data Root. Mode and AI choices guide setup, without new persistent settings
or automatic Stage Prompt templates. Changes use existing services and their normal safeguards.

## 3. Rejected alternatives

- Inferring completion from existing Boards or Me would skip the introduction for existing users.
- Per-person Data Root completion would repeat shared setup for every collaborator.
- Clearing flags to reopen onboarding would make an interrupted revisit change future launches.
