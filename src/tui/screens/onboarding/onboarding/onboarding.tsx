import { useState } from "react";
import { onboardingOptions } from "../../../../services/onboarding/onboarding.js";
import type { ServiceContext } from "../../../../services/workspace/workspace.js";
import { Loading } from "../../../components/index.js";
import { useAsync } from "../../../hooks/index.js";
import type { KeyHint } from "../../../keymap.js";
import { OnboardingChecklist } from "../onboarding-checklist/index.js";
import { OnboardingProjectStep } from "../onboarding-project-step/index.js";
import { OnboardingStart } from "../onboarding-start/index.js";
import { OnboardingSummary } from "../onboarding-summary/index.js";
import {
  type Choices,
  checklistProps,
  choose,
  chooseMode,
  type OnboardingEnv,
  onboardingView,
  type Step,
  summaryBackStep,
} from "./onboarding-choices.js";

/**
 * The steps that create a Project in the directory of `ctx`, on the screen and in order: defaults or
 * customize, name and key, Stages, skills, harnesses, summary. With defaults, the first step goes to the summary.
 */
export function Onboarding({
  ctx,
  onCreated,
  onHints,
}: {
  ctx: ServiceContext;
  onCreated(): void;
  onHints(hints: readonly KeyHint[]): void;
}) {
  const [step, setStep] = useState<Step>("start");
  const [customize, setCustomize] = useState(false);
  const [choices, setChoices] = useState<Choices>({ custom: [] });
  const options = useAsync(() => onboardingOptions(ctx), [ctx]);

  const env: OnboardingEnv = { setStep, setCustomize, setChoices, onHints };

  if (!options.data) {
    return options.loading ? <Loading label="Loading…" /> : null;
  }

  const view = onboardingView(options.data, choices, customize);

  if (step === "start") {
    return <OnboardingStart onHints={onHints} onChoose={(mode) => chooseMode(env, mode)} />;
  }

  if (step === "project") {
    return (
      <OnboardingProjectStep
        ctx={ctx}
        name={choices.name ?? view.defaults.name}
        projectKey={choices.key ?? view.defaults.key}
        onNext={(name, key) => choose(env, { name, key }, "stages")}
        onBack={() => setStep("start")}
        onHints={onHints}
      />
    );
  }

  if (step === "summary") {
    return (
      <OnboardingSummary
        ctx={ctx}
        input={view.input}
        onHints={onHints}
        onCreated={onCreated}
        onBack={() => setStep(summaryBackStep(customize, view.skills))}
      />
    );
  }

  return <OnboardingChecklist key={step} {...checklistProps(env, view, step)} onHints={onHints} />;
}
