import { useState } from "react";
import { checkStageKey, toStageKey } from "../../../../services/config/config.js";
import {
  isAlwaysEnabledStage,
  type OnboardingInput,
  onboardingOptions,
  requiredSkills,
  withCustomStages,
} from "../../../../services/onboarding/onboarding.js";
import type { ServiceContext } from "../../../../services/workspace/workspace.js";
import { Loading } from "../../../components/index.js";
import { useAsync } from "../../../hooks/index.js";
import type { KeyHint } from "../../../keymap.js";
import { OnboardingChecklist } from "../OnboardingChecklist/index.js";
import { OnboardingProjectStep } from "../OnboardingProjectStep/index.js";
import { OnboardingStart } from "../OnboardingStart/index.js";
import { OnboardingSummary } from "../OnboardingSummary/index.js";

type Step = "start" | "project" | "stages" | "skills" | "harnesses" | "summary";

interface Choices {
  name?: string;
  key?: string;
  /** The checked Stages, by name. */
  stages?: string[];
  /** The custom Stages that the user added, also when they are not checked. */
  custom: string[];
  skills?: string[];
  harnesses?: string[];
}

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
  if (!options.data) return options.loading ? <Loading label="Loading…" /> : null;

  const defaults = options.data;
  const stageChoices = withCustomStages(defaults.stages, choices.custom);
  const stages = choices.stages ?? stageChoices;
  const required = requiredSkills(stages);
  const skills = [...new Set([...required, ...(choices.skills ?? defaults.skills)])];
  const harnesses = choices.harnesses ?? defaults.harnesses.map((harness) => harness.id);
  const input: OnboardingInput = customize
    ? { name: choices.name, key: choices.key, stages, skills, harnesses: skills.length > 0 ? harnesses : [] }
    : {};
  const choose = (update: Partial<Choices>, next: Step) => {
    setChoices((current) => ({ ...current, ...update }));
    setStep(next);
  };

  if (step === "start") {
    return (
      <OnboardingStart
        onHints={onHints}
        onChoose={(mode) => {
          setCustomize(mode === "customize");
          setStep(mode === "customize" ? "project" : "summary");
        }}
      />
    );
  }
  if (step === "project") {
    return (
      <OnboardingProjectStep
        ctx={ctx}
        name={choices.name ?? defaults.name}
        projectKey={choices.key ?? defaults.key}
        onNext={(name, key) => choose({ name, key }, "stages")}
        onBack={() => setStep("start")}
        onHints={onHints}
      />
    );
  }
  if (step === "stages") {
    return (
      <OnboardingChecklist
        key="stages"
        heading="Stages"
        description="Default Stages have a prompt. A custom Stage gets a placeholder prompt."
        items={stageChoices.map((stage) => ({
          value: stage,
          label: stage,
          description: isAlwaysEnabledStage(stage)
            ? "(always enabled)"
            : choices.custom.includes(stage)
              ? "custom"
              : undefined,
          locked: isAlwaysEnabledStage(stage),
        }))}
        selected={stages}
        add={{
          label: "New Stage",
          onAdd: (text) => {
            const label = text.trim();
            const issue = checkStageKey(toStageKey(label))[0];
            if (issue) return { error: issue.message };
            const existing = stageChoices.find((stage) => toStageKey(stage) === toStageKey(label));
            if (existing) return { value: existing };
            setChoices((current) => ({ ...current, custom: [...current.custom, label] }));
            return { value: label };
          },
        }}
        onSubmit={(values) => choose({ stages: values }, "skills")}
        onBack={() => setStep("project")}
        onHints={onHints}
      />
    );
  }
  if (step === "skills") {
    return (
      <OnboardingChecklist
        key="skills"
        heading="Agent skills"
        description="Your default Stages use the required skills."
        items={defaults.skills.map((skill) => ({
          value: skill,
          label: skill,
          description: required.includes(skill) ? "(required)" : undefined,
          locked: required.includes(skill),
        }))}
        selected={skills}
        onSubmit={(values) => choose({ skills: values }, values.length > 0 ? "harnesses" : "summary")}
        onBack={() => setStep("stages")}
        onHints={onHints}
      />
    );
  }
  if (step === "harnesses") {
    return (
      <OnboardingChecklist
        key="harnesses"
        heading="Agent skills › Harnesses"
        description="Rowbly installs each skill for each harness that you choose."
        items={defaults.harnesses.map(({ id, dir }) => ({ value: id, label: id, description: dir }))}
        selected={harnesses}
        emptyError="Choose at least one harness"
        onSubmit={(values) => choose({ harnesses: values }, "summary")}
        onBack={() => setStep("skills")}
        onHints={onHints}
      />
    );
  }
  return (
    <OnboardingSummary
      ctx={ctx}
      input={input}
      onHints={onHints}
      onCreated={onCreated}
      onBack={() => setStep(!customize ? "start" : skills.length > 0 ? "harnesses" : "skills")}
    />
  );
}
