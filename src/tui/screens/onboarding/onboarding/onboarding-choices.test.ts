import { describe, expect, it, vi } from "vitest";
import type { OnboardingOptions } from "../../../../services/onboarding/onboarding.js";
import {
  checklistProps,
  chooseMode,
  type OnboardingEnv,
  onboardingView,
  summaryBackStep,
} from "./onboarding-choices.js";

const defaults: OnboardingOptions = {
  name: "app",
  key: "APP",
  stages: ["Backlog", "Develop", "Done"],
  skills: ["develop", "factory", "refine"],
  harnesses: [{ id: "codex", dir: ".agents/skills" }],
} as OnboardingOptions;

function env(): OnboardingEnv {
  return { setStep: vi.fn(), setCustomize: vi.fn(), setChoices: vi.fn(), onHints: vi.fn() };
}

describe("onboardingChoices", () => {
  it("gives an empty input with defaults and the answers with customize", () => {
    expect(onboardingView(defaults, { custom: [] }, false).input).toEqual({});

    const view = onboardingView(defaults, { custom: ["QA"], name: "X", skills: [] }, true);

    expect(view.stageChoices).toContain("QA");
    expect(view.input).toMatchObject({ name: "X", stages: view.stageChoices });
    expect(view.input.skills).toEqual(view.required);
  });

  it("goes to the project step or the summary from the start", () => {
    const e = env();

    chooseMode(e, "customize");
    chooseMode(e, "defaults");

    expect(e.setStep).toHaveBeenNthCalledWith(1, "project");
    expect(e.setStep).toHaveBeenNthCalledWith(2, "summary");
    expect(e.setCustomize).toHaveBeenNthCalledWith(2, false);
  });

  it("goes back from the summary to the last list step that the person saw", () => {
    expect(summaryBackStep(false, ["develop"])).toBe("start");
    expect(summaryBackStep(true, ["develop"])).toBe("harnesses");
    expect(summaryBackStep(true, [])).toBe("skills");
  });

  it("marks the locked and custom Stages, and adds a Stage once", () => {
    const e = env();
    const view = onboardingView(defaults, { custom: ["QA"] }, true);
    const props = checklistProps(e, view, "stages");

    expect(props.items.find((item) => item.value === "Backlog")).toMatchObject({
      description: "(always enabled)",
      locked: true,
    });
    expect(props.items.find((item) => item.value === "QA")?.description).toBe("custom");
    expect(props.add?.onAdd(" develop ")).toEqual({ value: "Develop" });
    expect(e.setChoices).not.toHaveBeenCalled();
    expect(props.add?.onAdd("Test")).toEqual({ value: "Test" });
    expect(e.setChoices).toHaveBeenCalledOnce();
    expect(props.add?.onAdd("!!!")).toHaveProperty("error");
  });

  it("marks the required skills and needs a harness", () => {
    const view = onboardingView(defaults, { custom: [] }, true);
    const skills = checklistProps(env(), view, "skills");
    const harnesses = checklistProps(env(), view, "harnesses");

    expect(skills.items.find((item) => item.value === "factory")?.description).toMatch(/required/);
    expect(harnesses.emptyError).toBe("Choose at least one harness");
    expect(harnesses.items).toEqual([{ value: "codex", label: "codex", description: ".agents/skills" }]);
  });
});
