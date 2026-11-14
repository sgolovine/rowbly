import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { NotFoundError } from "../errors/errors.js";
import { useTempDir, useTestProject } from "../test-project/test-project.js";
import { findProject, hasProject, projectPaths } from "./workspace.js";

describe("projectPaths", () => {
  it("puts every path inside .rowbly/", () => {
    expect(projectPaths("/repo")).toEqual({
      root: "/repo",
      dir: join("/repo", ".rowbly"),
      configFile: join("/repo", ".rowbly", "rowbly.config.json"),
      promptsDir: join("/repo", ".rowbly", "prompts"),
      legacyInstructionsFile: join("/repo", ".rowbly", "ROWBLY.md"),
      storiesDir: join("/repo", ".rowbly", "stories"),
      stagesDir: join("/repo", ".rowbly", "stages"),
      specsDir: join("/repo", ".rowbly", "specs"),
      ignoreFile: join("/repo", ".rowbly", ".gitignore"),
      factorySettingsFile: join("/repo", ".rowbly", "factory.json"),
      stateFile: join("/repo", ".rowbly", "state.json"),
      runtimeDir: join("/repo", ".rowbly", "runtime"),
    });
  });
});

describe("findProject", () => {
  const project = useTestProject();

  it("finds the project in cwd", async () => {
    expect((await findProject(project.ctx)).root).toBe(project.paths.root);
  });

  it("finds the project from a subfolder", async () => {
    const sub = join(project.paths.root, "a", "b");
    await mkdir(sub, { recursive: true });
    expect((await findProject({ cwd: sub })).root).toBe(project.paths.root);
  });
});

describe("findProject without a project", () => {
  const dir = useTempDir();

  it("throws a NotFoundError with a hint", async () => {
    const error = await findProject({ cwd: dir.path }).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(NotFoundError);
    expect((error as NotFoundError).hint).toMatch(/rowbly init/);
  });
});

describe("hasProject", () => {
  const project = useTestProject();

  it("is true in the directory of the project", async () => {
    expect(await hasProject(project.ctx)).toBe(true);
  });

  it("is false in a subfolder of the project", async () => {
    const sub = join(project.paths.root, "a");
    await mkdir(sub, { recursive: true });
    expect(await hasProject({ cwd: sub })).toBe(false);
  });
});
