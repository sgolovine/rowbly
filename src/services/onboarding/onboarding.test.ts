import { mkdir, readFile, writeFile } from "node:fs/promises";
import { basename, join } from "node:path";
import { describe, expect, it } from "vitest";
import { ConflictError, ValidationError } from "../errors/errors.js";
import { pathExists } from "../files/files.js";
import { useTempDir } from "../testProject/testProject.js";
import {
  applyOnboarding,
  isAlwaysEnabledStage,
  onboardingOptions,
  parseOnboardingInput,
  planOnboarding,
  requiredSkills,
  summarizePlan,
  withCustomStages,
} from "./onboarding.js";

describe("onboarding", () => {
  const dir = useTempDir();
  const ctx = () => ({ cwd: dir.path, home: dir.path });

  it("defaults to the directory name, its first three letters, all stages, skills and harnesses", async () => {
    const options = await onboardingOptions(ctx());
    expect(options.name).toBe(basename(dir.path));
    expect(options.stages).toEqual(["Backlog", "In Refinement", "In Development", "In Review", "Done"]);
    expect(options.skills).toEqual(["develop", "factory", "refine", "review"]);
    expect(options.harnesses.map((harness) => harness.id)).toEqual([
      "claude-code",
      "codex",
      "gemini-cli",
      "github-copilot",
      "cursor",
    ]);
  });

  it("marks the skills of the selected default stages as required", async () => {
    expect(requiredSkills(["Backlog", "IN_REVIEW", "QA"])).toEqual(["review"]);
    const plan = await planOnboarding({}, ctx());
    expect(plan.skills.filter((skill) => skill.required).map((skill) => skill.name)).toEqual([
      "develop",
      "refine",
      "review",
    ]);
    expect(summarizePlan(plan).find((row) => row.label === "Skills")?.value).toContain("develop (required), factory");
  });

  it("always creates Backlog and Done", async () => {
    const keys = async (stages: string[]) =>
      (await planOnboarding({ stages, skills: [] }, ctx())).stages.map((stage) => stage.key);
    expect(await keys([])).toEqual(["BACKLOG", "DONE"]);
    expect(await keys(["QA"])).toEqual(["BACKLOG", "QA", "DONE"]);
    expect(await keys(["Backlog", "QA", "Done"])).toEqual(["BACKLOG", "QA", "DONE"]);
    expect(isAlwaysEnabledStage("done")).toBe(true);
    expect(isAlwaysEnabledStage("In Review")).toBe(false);
  });

  it("puts custom stages before Done", () => {
    expect(withCustomStages(["Backlog", "Done"], ["QA", "qa", "Backlog"])).toEqual(["Backlog", "QA", "Done"]);
    expect(withCustomStages(["Backlog"], ["QA"])).toEqual(["Backlog", "QA"]);
  });

  it("creates the default stages from the top-level folder and installs the skills", async () => {
    const project = await applyOnboarding({ name: "App", harnesses: ["codex"] }, ctx());
    expect(project.stages).toHaveLength(5);
    expect(await readFile(join(dir.path, ".rowbly/stages/IN_DEVELOPMENT.md"), "utf8")).toContain("`develop` skill");
    expect(await pathExists(join(dir.path, ".agents/skills/develop/SKILL.md"))).toBe(true);
    expect(project.skills).toContainEqual({ name: "factory", harnesses: ["codex"] });
    expect(project.customFields.map((field) => field.key)).toEqual(["worktree", "pull_request"]);
  });

  it("writes a placeholder prompt for a custom stage", async () => {
    await applyOnboarding({ stages: ["Backlog", "QA Check"], skills: [] }, ctx());
    expect(await readFile(join(dir.path, ".rowbly/stages/QA_CHECK.md"), "utf8")).toContain("placeholder");
    expect(await readFile(join(dir.path, ".rowbly/stages/BACKLOG.md"), "utf8")).toContain("has not been started");
  });

  it.each([
    [{ key: "1x" }, "key"],
    [{ name: " " }, "name"],
    [{ stages: ["QA", "qa"], skills: [] }, "stages"],
    [{ stages: ["In Review"], skills: [] }, "skills"],
    [{ skills: ["nope"] }, "skills"],
    [{ harnesses: ["nope"] }, "harnesses"],
    [{ harnesses: [] }, "harnesses"],
  ])("rejects %j", async (input, field) => {
    const error = await planOnboarding(input, ctx()).catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(ValidationError);
    expect(JSON.stringify((error as ValidationError).details.issues)).toContain(`"${field}"`);
  });

  it("stops if a project exists", async () => {
    await mkdir(join(dir.path, ".rowbly"));
    await expect(planOnboarding({}, ctx())).rejects.toBeInstanceOf(ConflictError);
  });

  it("removes the project and the installed skills if an install fails", async () => {
    await mkdir(join(dir.path, ".agents/skills/review"), { recursive: true });
    await writeFile(join(dir.path, ".agents/skills/review/notes.md"), "mine");
    await expect(applyOnboarding({ harnesses: ["codex"] }, ctx())).rejects.toBeInstanceOf(ConflictError);
    expect(await pathExists(join(dir.path, ".rowbly"))).toBe(false);
    expect(await pathExists(join(dir.path, ".agents/skills/develop"))).toBe(false);
    expect(await readFile(join(dir.path, ".agents/skills/review/notes.md"), "utf8")).toBe("mine");
  });

  it("checks the shape of JSON input", () => {
    expect(parseOnboardingInput({ name: "A", stages: ["B"] })).toEqual({ name: "A", stages: ["B"] });
    expect(() => parseOnboardingInput([])).toThrow(ValidationError);
    expect(() => parseOnboardingInput({ stages: "B" })).toThrow(ValidationError);
    expect(() => parseOnboardingInput({ other: 1 })).toThrow(ValidationError);
  });
});
